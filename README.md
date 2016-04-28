#Mobile pincode module installation manual

> A module to add an optional pincode for your mobile device which replaces the username and password in a secure way. Supported by IOS, Android and Windows Mobile. Highly customizable in look and feel and server side logic.

##Requirements
 * Mendix version 5.16.2 or higher
 * Optional: LDAP module and its dependencies

##Installation
Follow the following steps to integrate the pin code module into your app. This will install the pin code module for use with local users only. For integration with LDAP, follow these instructions and then see below.

1) Import the package into your project. You will get a new module called “MobilePINLogin”
2) Configure your project security to use the new module:

> * Add a user role that will be assigned to anonymous users if your project does not already have such a role
> * Enable anonymous users, assign the role from the previous step
> * Assign the “MobilePINLogin.Anonymous” module role to your anonymous user role

3) Configure the navigation to use the module’s login screen

> * For phone and/or tablet, set the role-based homepage for the anonymous role to “MobilePINLogin.LoginPage”
> * Make sure your Desktop homepage for anonymous users has a way to log in (such as the login form widget form the app store), or redirects to your SSO solution.

4) Add the microflow “MobilePINLogin.StartLoginHandler” to your application’s startup flow.
 

You are now ready to use the PIN code login procedure. Start your project and view the phone, tablet or hybrid app to test the module.

The first time you access the app, you will see a login prompt. Enter your username and password you can optionally check or uncheck the checkbox to create a PIN. When you have checked the optional PIN you will be asked to set the PIN. The next time you access the app, you will be asked for your PIN again. When you enter the correct PIN, you will be logged in as normal. If you enter the wrong PIN, you will have to enter your username and password again. When you haven’t set the optional check box for the option PIN, you will be logged in as normal without the additional PIN.

When deploying to the cloud:

 * Add a request handler for “/mpinlogin/” to your app. To do this,
    * Go to your project’s “Deploy” page
    * Click “Details” on the node you deployed on
    * Click the “Network” button just below the title “Environment Details”
    * Scroll down to “Request Handlers”
    * If “/mpinlogin/” is listed, select it and click “Toggle”
    * If it is not listed, click “New”, enter “/mpinlogin/”, save and do the previous step

Optional steps:

 * You can configure the texts shown on the login screen in the microflow “MobilePINLogin.DS_PinTexts”
 * Change the look and feel by changing the theming package.
 * Add a microflow which will be triggered after login to, for example, open a specific homepage for a user.

##Integrating LDAP

When integrating LDAP, first configure the LDAP synchronization module by the instructions in its documentation. Make sure to use the “Authenticate users and create if account doesn’t exist” setting as the “LDAP type” when setting up the LDAP connection. This will make sure the connection is used to authenticate users when they log in. This will automatically also authenticate users when they log in with the PIN code widget.

To make sure users are automatically synchronized with LDAP when they log in, set the “MobilePINLogin.UserSyncAction” constant to “Ldap.Java_SyncSingleUser” (without quotes). This will update the user everytime he logs in, which makes sure the roles and access levels are always up-to-date with the LDAP server.

##PhoneGap permission

Due to security restrictions on IOS 8.4 and higher the focus between input fields is restricted. This can be mitigated by adding the following permission to config.xml during the build of the PhoneGap package.

```xml
  <preference name="KeyboardDisplayRequiresUserAction" value="false"/>
```


For more information see: https://cordova.apache.org/docs/en/4.0.0/guide_platforms_ios_config.md.html#iOS%20Configuration

##Known issues

 * When using the Mendix hybrid mobile developer app, you will be redirected to the home screen of the developer app after logging in, this is applicable for android devices. When you navigate back to the app (using the QR code or history) you will be logged in properly. This is a known issue that we cannot work around easily. When creating a packaged app for an app store, this will not occur.
 * The desktop simulator for mobile is not an actual mobile phone device, the widget can act differently on the desktop simulator then on an actual device. It is always advised to test mobile widgets on actual mobiles devices with Android, IOS and Windows Mobile.
 * Internet Explorer it is not able support both the numeric keyboard and password styled input boxes together. At this moment password styled input boxes are disabled, so that the input keyboard is shown in the numeric mode.
