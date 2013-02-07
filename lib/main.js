var widgets = require("sdk/widget");
var tabs = require("sdk/tabs");
data = require("sdk/self").data

var clockPanel = require("sdk/panel").Panel({
  contentScriptFile: [data.url("libs/jquery-1.8.2.js"),data.url("libs/underscore.js"),data.url("libs/backbone.js"),data.url("libs/bootstrap.js"),data.url("libs/sprintf-0.7-beta1.js"),data.url("js/popup.js")],
  contentURL: data.url("html/popup.html")
});
 
var widget = widgets.Widget({
  id: "mozilla-link",
  label: "Mozilla website",
  contentURL: data.url("img/eye.png"),
  panel: clockPanel
});