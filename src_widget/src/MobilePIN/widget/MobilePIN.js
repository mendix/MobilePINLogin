define([
    "dojo/_base/declare", "mxui/widget/_WidgetBase", "dijit/_TemplatedMixin",
    "mxui/dom", "dojo/dom", "dojo/query", "dojo/dom-prop", "dojo/dom-geometry", "dojo/dom-class", "dojo/dom-style", "dojo/dom-construct", "dojo/_base/array", "dojo/_base/lang", "dojo/text", "dojo/request/xhr", "dojo/_base/json", "dojo/_base/window",
    "MobilePIN/lib/jquery-1.11.2", "MobilePIN/lib/aes", "dojo/text!MobilePIN/widget/template/MobilePIN.html", "dojo/text!MobilePIN/widget/template/MobilePINBody.html", "dojo/text!MobilePIN/widget/template/MobilePINLogin.html", "dojo/text!MobilePIN/widget/template/MobilePINNewBody.html", "dojo/text!MobilePIN/widget/template/MobilePINTouch.html"
], function (declare, _WidgetBase, _TemplatedMixin, dom, dojoDom, domQuery, domProp, domGeom, domClass, domStyle, domConstruct, dojoArray, lang, text, xhr, dojoJSON, win, $, aes, widgetTemplate, bodyTemplate, loginTemplate, bodyNewTemplate, touchTemplate) {
    "use strict";

    // Declare widget"s prototype.
    return declare("MobilePIN.widget.MobilePIN", [_WidgetBase, _TemplatedMixin], {
        // _TemplatedMixin will create our dom node using this HTML template.
        templateString: widgetTemplate,

        // Parameters configured in the Modeler.
        mfToExecute: "",
        messageString: "",
        backgroundColor: "",

        // Internal variables. Non-primitives created in the prototype are shared between all widget instances.
        _handle: null,
        _contextObj: null,
        _objProperty: null,

        _loginText: null,
        _pinText: null,
        _pinAfterLoginText: null,
        _pinOptionalText: null,
        _forgotPinText: null,

        _pinCode: null,

        _clickEvent: null,

        _sleepMode: null,

        _uuid: null,

        // dojo.declare.constructor is called to construct the widget instance. Implement to initialize non-primitive properties.
        constructor: function () {
            //logger.level(logger.DEBUG);
            this._objProperty = {};
        },

        // dijit._WidgetBase.postCreate is called after constructing the widget. Implement to do extra setup work.
        postCreate: function () {
            logger.debug(this.id + ".postCreate");

            // Disable pincod
            this._pinCode = "";

            // UUID is set to nothing
            this._uuid = "";

            // Attach on deviceready
            document.addEventListener("deviceready", lang.hitch(this, this._onDeviceReady), false);

            // Determine click event
            this._clickEvent = ((document.ontouchstart == null) ? "click" : "touchstart");

            // Create Mobile PIN
            this._createMobilePIN();

            // Start with logic of the login widget.
            if (mx.session.isGuest()) {
                this._checkForAToken();
            }
        },

        // mxui.widget._WidgetBase.update is called when context is changed or initialized. Implement to re-render and / or fetch data.
        update: function (obj, callback) {
            logger.debug(this.id + ".update");

            this._contextObj = obj;
            this._resetSubscriptions();
            this._updateInterface();

            callback();
        },

        // mxui.widget._WidgetBase.uninitialize is called when the widget is destroyed. Implement to do special tear-down work.
        uninitialize: function () {
            logger.debug(this.id + ".uninitialize");
            // Clean up listeners, helper objects, etc. There is no need to remove listeners added with this.connect / this.subscribe / this.own.
        },

        _stopEvent: function (e) {
            logger.debug(this.id + "._stopEvent");
            var evt = e || window.event;
            if (evt.stopPropagation) {
                evt.stopPropagation();
            }
            if (evt.cancelBubble !== null) {
                evt.cancelBubble = true;
            }
        },

        /* ===========================================================
        Step 1 / 2: Go to page! We are logged in.
        =========================================================== */
        _gotoPageWhenLoggedIn: function (step, data) {
            logger.debug(this.id + "._gotoPageWhenLoggedIn");
            // Hide Mobile PIN!
            this._hideMobilePIN();

            this.redirectToHomeAfterLogin();
        },

        redirectToHomeAfterLogin: function () {
            logger.debug(this.id + ".redirectToHomeAfterLogin");
            if (window.cordova && window.device && device.platform === "Android") {
                logger.debug(this.id + ".redirectToHomeAfterLogin has cordova & is Android");
                mx.reload();
            } else {
                logger.debug(this.id + ".redirectToHomeAfterLogin change window.location");
                window.location = window.mx.appUrl;
            }
        },

        /* ===========================================================
        Step 1: Login after token received.
        Step 2: Login when we have a token.
        =========================================================== */
        _loginIfToken: function (step) {
            logger.debug(this.id + "._loginIfToken, step " + step);
            //console.log("Mobile PIN Login - Step " + step + " - executed _loginIfToken()");

            var _decryptedToken = null,
            _decryptedUsername = null,
            _encryptedToken = null,
            _encryptedUsername = null;

            // Get encrypted token and username
            _encryptedToken = localStorage.getItem("mpinToken");
            _encryptedUsername = localStorage.getItem("mpinUser");

            // Decrypt token and username.
            try {
                _decryptedUsername = CryptoJS.AES.decrypt(_encryptedUsername, "MPINVERSION1_" + this._pinCode).toString(CryptoJS.enc.Utf8);
                _decryptedToken = CryptoJS.AES.decrypt(_encryptedToken, "MPINVERSION1_" + this._pinCode).toString(CryptoJS.enc.Utf8);
                logger.debug(this.id + "._loginIfToken decrypted, username: " + _decryptedUsername + ", token: " + _decryptedToken);
            } catch (e) {
                logger.debug(this.id + "._loginIfToken decryption failed");
                // The decoded results for a wrong pin might not be utf-8 valid, making the decrypt throw an error.
                // Means the PIN was wrong either way.
                this._loginFailed();
                return;
            }

            // Do actual login
            xhr(mx.appUrl + "mpinlogin/", {
                handleAs: "json",
                headers: {
                    "csrfToken": mx.session.getCSRFToken(),
                    "mimetype": "application/json",
                    "Content-Type": "application/json"
                },
                method: "POST",
                data: dojoJSON.toJson({
                    action: "pinlogin",
                    params: {
                        username: _decryptedUsername,
                        token: _decryptedToken,
                        uuid: this._uuid,
                        locale: ""
                    }
                })
            }).then(lang.hitch(this, function (data) {
                logger.debug(this.id + "._loginIfToken xhr callback success, data", data);
                //console.log("Mobile PIN Login - Step " + step + " - start executing _gotoPageWhenLoggedIn()");
                if (typeof data.result !== "undefined") {
                    switch (data.result) {
                        case 200: // Happy flow
                            logger.debug(this.id + "._loginIfToken xhr callback success 200. mx csrf: " + mx.session.getCSRFToken() + " data csrf: " + data.csrftoken);
                            if (mx.session.getCSRFToken() === data.csrftoken) {
                                this._gotoPageWhenLoggedIn(step, data);
                            } else {
                                this.redirectToHomeAfterLogin();
                            }
                            break;
                        case 401: // Unhappy flow
                            this._loginFailed();
                            break;
                    }
                }
            }), lang.hitch(this, function (err) {
                logger.debug(this.id + "._loginIfToken xhr callback failed, err", err);
                //console.log("Mobile PIN Login - Step " + step + " - start executing _showLoginIfNoToken()");
                this._showLoginIfNoToken(err); // May need to think of flow!
            }), lang.hitch(this, function (evt) {
                logger.debug(this.id + "._loginIfToken xhr callback final, evt", evt);
                //console.log(evt);
            }));
        },

        _loginFailed: function () {
            logger.debug(this.id + "._loginFailed");
            localStorage.setItem("mpinToken", "");
            localStorage.setItem("mpinUser", "");
            this._showMobilePINLogin();
            $("#_pinUser").val("");
            $("#_pinPassword").val("");
            $("#_pinUser").focus();
            this._showLoginIfNoToken("The PIN you entered is incorrect.");
        },

        /* ===========================================================
        Step 1: Result after login and no token.
        =========================================================== */
        _createMobilePINNew: function (data) {
            logger.debug(this.id + "._createMobilePINNew");
            if (!dojoDom.byId("mobilePINNewBody")) {
                logger.debug(this.id + "._createMobilePINNew no #mobilePINNewBody, creating");
                this._pinCode = "";

                var domNode = domConstruct.toDom(bodyNewTemplate);
                domConstruct.place(domNode, this.domNode);

                $("#pinAfterLoginText").html(this._pinAfterLoginText);

                $("#mobilePINNewBody").removeClass("hide");

                dojoDom.byId("_pinNew1").focus();
                //setTimeout(function () { document.getElementById("_pinNew1").focus(); }, 10);

                // Timeout is to fix the focus in IE (http://stackoverflow.com/questions/2600186/focus-doesnt-work-in-ie)

                //this._checkPasswordInputIE("_pinNew1");
                this.connect(dojoDom.byId("_pinNew1"), "keyup", lang.hitch(this, function () {
                    logger.debug(this.id + "._pinNew1 keyup");
                    if (isNaN($("#_pinNew1").val())) {
                        dojoDom.byId("_pinNew1").focus();
                        $("#_pinNew1").val("");
                    } else {
                        dojoDom.byId("_pinNew2").focus();
                        this._pinCode += $("#_pinNew1").val();
                    }
                }));

                //this._checkPasswordInputIE("_pinNew2");
                this.connect(dojoDom.byId("_pinNew2"), "keyup", lang.hitch(this, function () {
                    logger.debug(this.id + "._pinNew2 keyup");
                    if (isNaN($("#_pinNew2").val())) {
                        dojoDom.byId("_pinNew2").focus();
                        $("#_pinNew2").val("");
                    } else {
                        dojoDom.byId("_pinNew3").focus();
                        this._pinCode += $("#_pinNew2").val();
                    }
                }));

                //this._checkPasswordInputIE("_pinNew3");
                this.connect(dojoDom.byId("_pinNew3"), "keyup", lang.hitch(this, function () {
                    logger.debug(this.id + "._pinNew3 keyup");
                    if (isNaN($("#_pinNew3").val())) {
                        dojoDom.byId("_pinNew3").focus();
                        $("#_pinNew3").val("");
                    } else {
                        dojoDom.byId("_pinNew4").focus();
                        this._pinCode += $("#_pinNew3").val();
                    }
                }));

                //this._checkPasswordInputIE("_pinNew4");
                this.connect(dojoDom.byId("_pinNew4"), "keyup", lang.hitch(this, function () {
                    logger.debug(this.id + "._pinNew4 keyup");
                    if (isNaN($("#_pinNew4").val())) {
                        dojoDom.byId("_pinNew4").focus();
                        $("#_pinNew4").val("");
                    } else {
                        dojoDom.byId("_pinNew5").focus();
                        this._pinCode += $("#_pinNew4").val();
                    }
                }));

                //this._checkPasswordInputIE("_pinNew5");
                this.connect(dojoDom.byId("_pinNew5"), "keyup", lang.hitch(this, function () {
                    logger.debug(this.id + "._pinNew5 keyup");
                    if (isNaN($("#_pinNew5").val())) {
                        dojoDom.byId("_pinNew5").focus();
                        $("#_pinNew5").val("");
                    } else {
                        this._pinCode += $("#_pinNew5").val();
                        logger.debug(this.id + "._pinNew5 final, _pinCode = " + this._pinCode);
                        document.getElementById("_pinNew5").blur();
                        document.activeElement.blur();
                        this._renderResultIfLoginAndNoToken(data);
                    }
                }));

            } else {
                logger.debug(this.id + "._createMobilePINNew exists #mobilePINNewBody, showing");
                $("#mobilePINNewBody").removeClass("hide");
            }

        },

        _checkPasswordInputIE: function (id) {
            logger.debug(this.id + "._checkPasswordInputIE");
            var elem = document.getElementById(id);
            var style = window.getComputedStyle(elem);
            if (style.webkitTextSecurity) {
                //do nothing
            } else {
                // IE detected, doesnt support text security
                elem.setAttribute("type", "password");
            }
        },

        _renderResultIfLoginAndNoToken: function (data) {
            logger.debug(this.id + "._renderResultIfLoginAndNoToken, data", data);
            $("#mobilePINNewBody").addClass("hide");

            //console.log("Mobile PIN Login - Step 1 - executed _renderResultIfLoginAndNoToken()");

            var _encryptedToken = null,
            _encryptedUsername = null;

            if (typeof data.token !== undefined) {
                logger.debug(this.id + "._renderResultIfLoginAndNoToken has data.token: " + data.token + ", user is " + $("#_pinUser").val());
                // Encrypt token and username
                _encryptedToken = CryptoJS.AES.encrypt(data.token, "MPINVERSION1_" + this._pinCode);
                _encryptedUsername = CryptoJS.AES.encrypt($("#_pinUser").val(), "MPINVERSION1_" + this._pinCode);

                // Save encrypted username and password
                localStorage.setItem("mpinToken", _encryptedToken);
                localStorage.setItem("mpinUser", _encryptedUsername);
                logger.debug(this.id + "._renderResultIfLoginAndNoToken set localStorage with pincode " + this._pinCode + ", encToken: " + _encryptedToken + ", encUser: " + _encryptedUsername);
            }

            this.redirectToHomeAfterLogin();

            //mx.login();
        },

        /* ===========================================================
        Step 1: Result after login has failed and no token.
        =========================================================== */
        _renderResultIfNoLoginAndNoToken: function (err) {
            logger.debug(this.id + "._renderResultIfNoLoginAndNoToken, err", err);
            var _html = "";
            $(this.domNode).html(_html + "<span><br><strong>Error</strong>" + err.toString() + "</br></span>");
        },


        /* ===========================================================
        Step 1: Login when no token.
        =========================================================== */
        _showMobilePINLogin: function () {
            logger.debug(this.id + "._showMobilePINLogin");
            $("#mobilePINLogin").removeClass("hide");
        },
        _hideMobilePINLogin: function () {
            logger.debug(this.id + "._hideMobilePINLogin");
            $("#mobilePINLogin").addClass("hide");
        },
        _showLoginIfNoToken: function (err) {
            logger.debug(this.id + "._showLoginIfNoToken, err", err);
            //console.log("Mobile PIN Login - Step 1 - start executing _loginVerifyIfNoToken()");

            if (!dojoDom.byId("mobilePINLogin")) {
                logger.debug(this.id + "._showLoginIfNoToken no #mobilePINLogin, creating");

                var template = loginTemplate;
                template = template.replace("{{username_caption}}", this.strUsername);
                template = template.replace("{{password_caption}}", this.strPassword);
                template = template.replace("{{submit_caption}}", this.strSubmit);

                var domNode = domConstruct.toDom(template);
                domConstruct.place(domNode, this.domNode);

                $("#loginText").html(this._loginText);
                $("#pin-usePinLabel").html(this._pinOptionalText);

                this.connect(dojoDom.byId("_pinSubmit"), this._clickEvent, lang.hitch(this, function (e) {
                    this._stopEvent(e);
                    this._hideMobilePINLogin();
                    this._loginVerifyIfNoToken();
                }));

                this.connect(dojoDom.byId("pin-usePin"), "onchange", lang.hitch(this, this._onChangeUsePinCheckbox));
                this._setCheckboxForUsePinToken();
            }

            this._showMobilePINLogin();

            var $mobilePinBody = $("#mobilePINBody");
            $mobilePinBody.addClass("hide");

            // Check if there was an error send with it.
            if (typeof err === "undefined" || err === "") {
                $("#pin-error").html();
            } else {
                $("#pin-error").html("<div class=\"alert alert-danger\" role=\"alert\">" + err + "</div>");
            }

        },

        _loginVerifyIfNoToken: function () {
            logger.debug(this.id + "._loginVerifyIfNoToken");
            var mobilepinbody = $(dojoDom.byId("mobilePINBody"));
            if (mobilepinbody && !(mobilepinbody.hasClass("hide"))) {
                mobilepinbody.addClass("hide");
            }

            var path = mx.baseUrl.replace("xas/", "");
            xhr(path + "mpinlogin/", {
                handleAs: "json",
                headers: {
                    "csrfToken": mx.session.getCSRFToken(),
                    "mimetype": "application/json",
                    "Content-Type": "application/json"
                },
                method: "POST",
                data: dojoJSON.toJson({
                    action: "login",
                    params: {
                        username: $("#_pinUser").val(),
                        password: $("#_pinPassword").val(),
                        uuid: this._uuid,
                        locale: ""
                    }
                })
            }).then(lang.hitch(this, function (data) {
                logger.debug(this.id + "._loginVerifyIfNoToken xhr callback success, data", data);
                //console.log("Mobile PIN Login - Step 1 - start executing _renderResultIfLoginAndNoToken()");
                if (typeof data.result !== "undefined") {
                    logger.debug(this.id + "._loginVerifyIfNoToken xhr callback data.result:" + data.result);
                    switch (data.result) {
                        case 200: // Happy flow
                            logger.debug(this.id + "._loginVerifyIfNoToken xhr callback 200");
                            //console.log("Use Optional Pin - log in succesful. Checking if we should use PIN at all...");
                            var usePinToken = this._checkForUsePinToken();
                            if (usePinToken === "true") {
                                logger.debug(this.id + "._loginVerifyIfNoToken xhr callback 200, usePinToken === true");
                                if (mx.session.getCSRFToken() === data.csrftoken) {
                                    logger.debug(this.id + "._loginVerifyIfNoToken xhr callback 200 data.csrftoken === mx.session.getCSRFToken()");
                                    this._createMobilePINNew(data);
                                }
                            } else {
                                logger.debug(this.id + "._loginVerifyIfNoToken xhr callback 200, usePinToken === false");
                                //console.log("Use Optional Pin - log in succesful. Skipping PIN!");
                                this._skipTokenLogin();
                            }
                            break;
                        case 401: // Unhappy flow
                            logger.debug(this.id + "._loginVerifyIfNoToken xhr callback 401");
                            this._showMobilePINLogin();
                            $("#_pinUser").val("");
                            $("#_pinPassword").val("");
                            $("#_pinUser").focus();
                            this._showLoginIfNoToken("The username or password is incorrect.");
                            break;
                    }
                }
            }), lang.hitch(this, function (err) {
                logger.debug(this.id + "._loginVerifyIfNoToken xhr callback error, err", err);
                //console.log("Mobile PIN Login - Step 1 - ERROR - start executing _showLoginIfNoToken()");
                this._showLoginIfNoToken(err);
            }), lang.hitch(this, function (evt) {
                logger.debug(this.id + "._loginVerifyIfNoToken xhr callback final, evt", evt);
                //console.log(evt);
            }));
        },

        /* ===========================================================
        Step 1: Check for a token!
        =========================================================== */
        _supportLocalStorage: function () {
            logger.debug(this.id + "._supportLocalStorage");
            try {
                return window.localStorage !== null;
            } catch (e) {
                return false;
            }
        },
        _checkForAToken: function () {
            logger.debug(this.id + "._checkForAToken");
            // Check out if we have local storage or not?!
            if (this._supportLocalStorage()) {

                var mpinToken = localStorage.getItem("mpinToken");

                if (typeof mpinToken !== "undefined" && mpinToken !== "" && mpinToken !== null) {
                    logger.debug(this.id + "._checkForAToken has mpinToken :: Mobile PIN Login - Step 2 - start executing _loginIfToken()");
                    this._showMobilePIN();
                } else {
                    logger.debug(this.id + "._checkForAToken has NO mpinToken :: Mobile PIN Login - Step 1 - start executing _showLoginIfNoToken()");
                    this._showLoginIfNoToken("");
                }

            } else {
                console.log("Mobile PIN Login - No support for local storage!");
            }

        },

        _checkForUsePinToken: function () {
            logger.debug(this.id + "._checkForUsePinToken");
            // Check out if we have local storage or not?!
            //console.log("Use Optional Pin - Checking for usePinToken ");
            if (this._supportLocalStorage()) {

                var mUsePinToken = localStorage.getItem("mUsePinToken");

                if (typeof mUsePinToken !== "undefined" && mUsePinToken !== "" && mUsePinToken !== null) {
                    logger.debug(this.id + "._checkForUsePinToken has mUsePinToken :: Use Optional Pin - Found token with value:" + mUsePinToken);
                    return mUsePinToken;
                } else {
                    return false;
                }

            } else {
                console.log("Mobile PIN Login - No support for local storage!");
                return false;
            }
        },

        _setCheckboxForUsePinToken: function () {
            logger.debug(this.id + "._setCheckboxForUsePinToken");
            // Check out if we have local storage or not?!
            //console.log("Use Optional Pin - Checking for usePinToken ");
            if (this._supportLocalStorage()) {

                var mUsePinToken = localStorage.getItem("mUsePinToken");

                if (typeof mUsePinToken !== "undefined" && mUsePinToken !== "" && mUsePinToken !== null) {
                    logger.debug(this.id + "._setCheckboxForUsePinToken has mpinToken :: Use Optional Pin - Found token with value:" + mUsePinToken);
                    this._setUsePinCheckbox(mUsePinToken);
                } else {
                    this._setUsePinCheckbox(false);
                }

            } else {
                console.log("Mobile PIN Login - No support for local storage!");
            }
        },

        _setUsePinCheckbox: function (val) {
            logger.debug(this.id + "._setUsePinCheckbox, val: ", val);
            //console.log("Use Optional Pin - Setting use pin checkbox to: ", val);
            $("#pin-usePin").prop("checked", val === "true"); // Localstorage doesnt support booleans, so its "true"
        },

        _onChangeUsePinCheckbox: function () {
            logger.debug(this.id + "._onChangeUsePinCheckbox");
            //console.log("Use Optional Pin - Use Pin checkbox clicked! ");

            var value = $("#pin-usePin").prop("checked");

            if (this._supportLocalStorage()) {
                localStorage.setItem("mUsePinToken", value);
                if (value === false) {
                    localStorage.removeItem("mpinUser");
                    localStorage.removeItem("mpinToken");
                }
            } else {
                //console.log("Mobile PIN Login - No support for local storage!");
            }
        },

        _skipTokenLogin: function () {
            logger.debug(this.id + "._skipTokenLogin, #mobilePINNewBody has:hide = " + $("#mobilePINNewBody").hasClass("hide"));
            if (!$("#mobilePINNewBody").hasClass("hide")) {
                $("#mobilePINNewBody").addClass("hide");
            }
            this.redirectToHomeAfterLogin();
            //mx.login();
        },

        /* ===========================================================
        Step 0: Check for a token!
        =========================================================== */
        _showMobilePIN: function () {
            logger.debug(this.id + "._showMobilePIN");
            $("#mobilePINBody").removeClass("hide");
        },
        _hideMobilePIN: function () {
            logger.debug(this.id + "._hideMobilePIN");
            $("#mobilePINBody").addClass("hide");
        },
        _onDeviceReady: function () {
            logger.debug(this.id + "._onDeviceReady");
            this._uuid = device.uuid || "";
            document.addEventListener("pause", lang.hitch(this, this._pauseMobilePIN), false);
            document.addEventListener("resume", lang.hitch(this, this._resumeMobilePIN), false);
        },
        _pauseMobilePIN: function () {
            logger.debug(this.id + "._pauseMobilePIN");
            var mpinToken = localStorage.getItem("mpinToken");
            if (typeof mpinToken !== "undefined" && mpinToken !== "" && mpinToken !== null) {
                logger.debug(this.id + "._pauseMobilePIN has mpinToken");
                this._pinCode = "";
                $("#_pin1").val("");
                $("#_pin2").val("");
                $("#_pin3").val("");
                $("#_pin4").val("");
                $("#_pin5").val("");
                $("#mobilePINBody").removeClass("hide");
                $("#_pin1").focus();
            } else {
                logger.debug(this.id + "._pauseMobilePIN has NO mpinToken");
                this._showLoginIfNoToken();
            }
        },
        _resumeMobilePIN: function () {
            var isGuest = mx.session.isGuest(),
                csrfToken = mx.session.getCSRFToken();
            logger.debug(this.id + "._resumeMobilePIN, guest: " + isGuest + ", csrfToken: " + csrfToken);
        },
        _createMobilePIN: function () {
            logger.debug(this.id + "._createMobilePIN");
            if (!dojoDom.byId("mobilePINBody")) {
                logger.debug(this.id + "._createMobilePIN no #mobilePINBody, creating");
                var domNode = domConstruct.toDom(bodyTemplate);
                domConstruct.place(domNode, this.domNode);

                $("#pinText").html(this._pinText);
                $("#forgotPin").html(this._forgotPinText);

                this.connect(dojoDom.byId("forgotPin"), this._clickEvent, lang.hitch(this, function () {
                    this._showMobilePINLogin();
                    $("#_pinUser").val("");
                    $("#_pinPassword").val("");
                    $("#_pinUser").focus();
                    this._showLoginIfNoToken();
                }));

                //setTimeout(function() { document.getElementById("_pin1").focus(); }, 10);
                // Timeout is to fix the focus in IE (http://stackoverflow.com/questions/2600186/focus-doesnt-work-in-ie)
                dojoDom.byId("_pin1").focus();

                //this._checkPasswordInputIE("_pin1");
                this.connect(dojoDom.byId("_pin1"), "keyup", lang.hitch(this, function () {
                    logger.debug(this.id + "._pin1 keyup");
                    if (isNaN($("#_pin1").val())) {
                        dojoDom.byId("_pin1").focus();
                        $("#_pin1").val("");
                    } else {
                        dojoDom.byId("_pin2").focus();
                        this._pinCode += $("#_pin1").val();
                    }
                }));

                //this._checkPasswordInputIE("_pin2");
                this.connect(dojoDom.byId("_pin2"), "keyup", lang.hitch(this, function () {
                    logger.debug(this.id + "._pin2 keyup");
                    if (isNaN($("#_pin2").val())) {
                        dojoDom.byId("_pin2").focus();
                        $("#_pin2").val("");
                    } else {
                        dojoDom.byId("_pin3").focus();
                        this._pinCode += $("#_pin2").val();
                    }
                }));

                //this._checkPasswordInputIE("_pin3");
                this.connect(dojoDom.byId("_pin3"), "keyup", lang.hitch(this, function () {
                    logger.debug(this.id + "._pin3 keyup");
                    if (isNaN($("#_pin3").val())) {
                        dojoDom.byId("_pin3").focus();
                        $("#_pin3").val("");
                    } else {
                        dojoDom.byId("_pin4").focus();
                        this._pinCode += $("#_pin3").val();
                    }
                }));

                //this._checkPasswordInputIE("_pin4");
                this.connect(dojoDom.byId("_pin4"), "keyup", lang.hitch(this, function () {
                    logger.debug(this.id + "._pin4 keyup");
                    if (isNaN($("#_pin4").val())) {
                        dojoDom.byId("_pin4").focus();
                        $("#_pin4").val("");
                    } else {
                        dojoDom.byId("_pin5").focus();
                        this._pinCode += $("#_pin4").val();
                    }
                }));

                //this._checkPasswordInputIE("_pin5");
                this.connect(dojoDom.byId("_pin5"), "keyup", lang.hitch(this, function () {
                    logger.debug(this.id + "._pin5 keyup");
                    if (isNaN($("#_pin5").val())) {
                        dojoDom.byId("_pin5").focus();
                        $("#_pin5").val("");
                    } else {
                        this._pinCode += $("#_pin5").val();
                        document.getElementById("_pin5").blur();
                        document.activeElement.blur();
                        this._loginIfToken();
                    }
                }));

            }
        },

        _updateInterface: function () {
            logger.debug(this.id + "._updateInterface");

            this._setCaption("_pinAfterLoginText", "trPinAfterLoginText", "pinAfterLoginText", "#pinAfterLoginText");
            this._setCaption("_loginText", "trLoginText", "loginText", "#loginText");
            this._setCaption("_pinText", "trPinLoginText", "pinLoginText", "#pinText");
            this._setCaption("_pinOptionalText", "trPinOptionalText", "pinOptionalText", "#pin-usePinLabel");
            this._setCaption("_forgotPinText", "trForgotPinText", "forgotPinText", "#forgotPin");
        },

        _setCaption: function (internal, translatable, attribute, element) {
            logger.debug(this.id + "._setCaption: " + internal);
            if (this[translatable] !== "") {
                this[internal] = this[translatable];
                $(element).html(this[translatable]);
            } else if (this._contextObj !== null && this[attribute] !== "") {
                this._contextObj.fetch(this[attribute], lang.hitch(this, function (value) {
                    $(element).html(value);
                    this[internal] = value;
                }));
            } else {
                this[internal] = "";
            }
        },

        _resetSubscriptions: function () {
            logger.debug(this.id + "._resetSubscriptions");
            // Release handle on previous object, if any.
            if (this._handle) {
                this.unsubscribe(this._handle);
                this._handle = null;
            }

            if (this._contextObj) {
                this._handle = this.subscribe({
                    guid: this._contextObj.getGuid(),
                    callback: this._updateInterface
                });
            }
        }
    });
});

require(["MobilePIN/widget/MobilePIN"]);
