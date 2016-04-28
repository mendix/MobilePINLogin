package mobilepinlogin.actions.custom;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.locks.ReentrantLock;

import javax.servlet.http.HttpServletResponse;

import mobilepinlogin.proxies.PINLogin;
import mobilepinlogin.proxies.constants.Constants;
import mobilepinlogin.proxies.microflows.Microflows;

import org.apache.commons.codec.binary.Hex;
import org.apache.commons.io.IOUtils;
import org.json.JSONObject;

import system.proxies.User;

import com.mendix.core.Core;
import com.mendix.core.session.Session;
import com.mendix.core.CoreException;
import com.mendix.externalinterface.connector.RequestHandler;
import com.mendix.logging.ILogNode;
import com.mendix.m2ee.api.IMxRuntimeRequest;
import com.mendix.m2ee.api.IMxRuntimeResponse;
import com.mendix.systemwideinterfaces.core.IContext;
import com.mendix.systemwideinterfaces.core.IMendixObject;
import com.mendix.systemwideinterfaces.core.ISession;
import com.mendix.systemwideinterfaces.core.IUser;

public final class LoginPINRequestHandler extends RequestHandler {

	// Internal variables.
	private final static String MOBILE_PIN_APP = "Mobile PIN Request Handler - ";
	private final static ILogNode log = Core.getLogger("PINLoginHandler");
    private ReentrantLock lock = new ReentrantLock();

	@Override
	public void processRequest(IMxRuntimeRequest request, IMxRuntimeResponse response, String path) throws Exception
	{
		// Get the path of the request
		JSONObject jsonRequest;
		JSONObject result = new JSONObject();
		String username, password, token, uuid;

		// Create request handler
    	log.trace(MOBILE_PIN_APP + "Process request from HTTP Request Handler");

    	// Get the JSON raw content of the POST request.
    	StringBuffer jb = new StringBuffer();
		String line = null;
		try {

			// Read out the raw request data.
			BufferedReader reader = request.getHttpServletRequest().getReader();
			while ((line = reader.readLine()) != null){
				jb.append(line);
			}

			// Create a JSON request JSON object.
			jsonRequest = new JSONObject(jb.toString());
			log.debug(MOBILE_PIN_APP + "result JSON request: " + jb.toString());

			// Read action if is set.
			if (jsonRequest.get("action") != null) {

				JSONObject params = new JSONObject();

				switch(jsonRequest.get("action").toString()) {
					case "login":
						// Get the params like username and token here.
						params = (JSONObject) jsonRequest.get("params");
						username = params.getString("username");
						password = params.getString("password");
						uuid = params.getString("uuid");

						try {
							ISession newSession = Core.login(username, password, request);
							if (newSession != null) {
								newSession.setUserAgent(request.getHeader("User-Agent"));
								log.info("Login OK: user '" + username +
										"' (Number of concurrent sessions: " + Core.getNumberConcurrentSessions() + ").");

                                String csrfToken = ((Session)newSession).getCsrfToken();

								result.put("csrftoken", csrfToken);
								result.put("result", IMxRuntimeResponse.OK);
								result.put("token", generateToken(newSession.getUser(), uuid).getToken());
								response.addCookie(XAS_SESSION_ID, newSession.getId().toString(),"/" ,"" ,-1 );
							} else {
								result.put("result", IMxRuntimeResponse.UNAUTHORIZED);
							}
						} catch (Exception e) {
							logger.info("Error while logging in " + username, e);
							result.put("result", IMxRuntimeResponse.UNAUTHORIZED);
						}


						break;
					case "pinlogin":
						params = (JSONObject) jsonRequest.get("params");
						username = params.getString("username");
						token = params.getString("token");
						uuid = params.getString("uuid");

						try {
							IContext sysContext = Core.createSystemContext();
							if (username == null || username.isEmpty()) {
							    logger.warn("No username specified in pinlogin request.");
                                result.put("result", IMxRuntimeResponse.UNAUTHORIZED);
							    break;
                            }

							IUser user = Core.getUser(sysContext, username);

							if (user == null) {
								logger.warn("User " + username + " not found.");
								result.put("result", IMxRuntimeResponse.UNAUTHORIZED);
							} else if (!validateToken(user, uuid, token)) {
								logger.warn("User " + user.getName() + " was not able to login with his token.");
								result.put("result", IMxRuntimeResponse.UNAUTHORIZED);
							} else {
							    // login the user, taken from ldap module code
							    // sync if configured to do so
							    String syncAction = Constants.getUserSyncAction();
							    if (syncAction != null && !syncAction.isEmpty()) {
                                    Map<String, Object> mfParameters = new HashMap<>();
                                    mfParameters.put("Username", username);
                                    Core.execute(sysContext, syncAction, mfParameters);
		                            // refresh user since roles may have changed
							        user = Core.getUser(sysContext, username);
							    }

							    User userObj = User.initialize(sysContext, user.getMendixObject());

							    if (userObj.getActive() && !userObj.getBlocked() && userObj.getUserRoles().size() > 0) {
						            ISession newSession;

						            this.lock.lock();
						            try {
						                newSession = Core.initializeSession(user, request.getCookie(XAS_SESSION_ID));
						            }
						            finally {
						                this.lock.unlock();
						            }

	                                log.info("Login OK: user '" + username +
	                                        "' (Number of concurrent sessions: " + Core.getNumberConcurrentSessions() + ").");

	                                result.put("csrftoken", newSession.getData().get("CSRFToken"));
	                                result.put("result", IMxRuntimeResponse.OK);
	                                response.addCookie(XAS_SESSION_ID, newSession.getId().toString(),"/" ,"" ,-1 );
						        } else {
						            logger.warn("Login FAILED: user " + username + " is inactive or blocked or has no userroles");
	                                result.put("result", IMxRuntimeResponse.UNAUTHORIZED);
						        }
							}
						} catch (Exception e) {
							logger.info("Error while logging in with PIN for " + username, e);
							result.put("result", IMxRuntimeResponse.UNAUTHORIZED);
						}

						break;

					default:
						result.put("result", IMxRuntimeResponse.BAD_REQUEST);
				}

			} else {
				result.put("result", IMxRuntimeResponse.BAD_REQUEST);
			}

		} catch (Exception e) {
			log.info(MOBILE_PIN_APP + "error:" + e.getMessage() + e.getStackTrace().toString());
			result.put("response", "false");
		}

		// Create response from the request handler.
		response.setContentType("application/json");
		response.setCharacterEncoding("UTF-8");
	    OutputStream outputStream = response.getOutputStream();
	    InputStream answerStream = IOUtils.toInputStream(result.toString());
	    IOUtils.copy(answerStream, outputStream);
	    IOUtils.closeQuietly(outputStream);
	}

	private boolean validateToken(IUser user, String uuid, String token) throws CoreException {
		IContext sysContext = Core.createSystemContext();
		User account = User.initialize(sysContext, user.getMendixObject());

		List<IMendixObject> pins = Core.retrieveByPath(sysContext, account.getMendixObject(),
		        PINLogin.MemberNames.PINLogin_User.toString());
		if (pins == null || pins.isEmpty()) {
			log.error("User " + user.getName() + " was about to login with PIN, but has never authenticated before.");
			return false;
		}

		// try all pins
		for (IMendixObject pinobj : pins) {
		    PINLogin pin = PINLogin.initialize(sysContext, pinobj);
		    Date now = new Date();
	        if (pin.getExpired().compareTo(now) < 0) {
	            log.debug("User " + user.getName() + " has an expired token.");
	            continue; // try next token
	        }

	        try {
	            if (!getHash(pin.getChallenge() + uuid).equals(token)) {
	                log.debug("User " + user.getName() + " token mismatch.");
	                continue; // try next token
	            } else {
	                // successful login
	                return true;
	            }
	        } catch (Exception e) {
	            log.error("Error while decrypting a token.", e);
                continue; // try next token
	        }
		}

		log.error("User " + user.getName() + " tried to login using PIN, but does not have matching token.");
		return false;
	}

	private PINLogin generateToken(IUser user, String uuid) throws CoreException {
		IContext sysContext = Core.createSystemContext();
		User account = User.initialize(sysContext, user.getMendixObject());

		// always generate a new token, so that multiple devices can be used
		PINLogin pinLogin = new PINLogin(sysContext);
		pinLogin.setPINLogin_User(account);

		Microflows.java_CalculateNextExpiration(sysContext, pinLogin);

		pinLogin.setChallenge(UUID.randomUUID().toString());
		try {
			pinLogin.setToken(
					getHash(pinLogin.getChallenge() + uuid)
					);
		} catch (Exception e) {
			log.critical("Unable to generate a token.", e);
			return null;
		}

		pinLogin.commit();

		return pinLogin;
	}

    /**
     * Sends a redirect (the redirect method provided by the class is less reliable).
     *
     * @param response
     * @param path
     */
    protected static void redirect(IMxRuntimeResponse response, String path) {
    	log.info(MOBILE_PIN_APP + "Redirecting to location: "+ path);
        response.setStatus(HttpServletResponse.SC_SEE_OTHER);
        response.addHeader("location", path);
    }

    private String getHash(String input) throws Exception {
    	MessageDigest md = MessageDigest.getInstance("SHA-256");
    	md.update(input.getBytes("UTF-8"));
    	return Hex.encodeHexString(md.digest());
    }

}
