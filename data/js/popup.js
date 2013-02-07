///////////Global vars/////////////
var baseUrl = "http://localhost:5000"; 
// global website base, set to localhost for testing
//var baseUrl = "http://eyebrowse.herokuapp.com"
var siteName = "Eyebrowse";

///////////Models//////////////

//This object can represent either a whitelist or blacklist for a given user. On an update send results to server to update stored data. On intialization set is synced with server. Should allow offline syncing in the future.
var FilterListItem = Backbone.Model.extend({
    parse: function(data) {
        if (data != null) {
            return {
                url : data.url, 
                id : data.id,
            }
        }
    },
});


var FilterList = Backbone.Collection.extend({

    model: FilterListItem,

    initialize: function(type) {
        _.bindAll(this);
        this.type = type;
        this.fetch()
    },
    getType : function() {
        return this.get('type')
    },
    url : function() {
        return getApiURL(this.type)
    },
    parse: function(data, res){
        if (res.status === 200) {
            return data.objects;    
        }
        user.logout() //triggers logout badge update
    },
});


//User object holds the status of the user, the cookie from the server, preferences for eyebrowse, whitelist, blacklist, etc
var User = Backbone.Model.extend({
    defaults: {
        'loggedIn' : false,
        'whitelist' : new FilterList('whitelist'),
        'blacklist' : new FilterList('blacklist'),
        'username' : '',
        'resourceURI' : '/api/v1/user/',
    },

    initialize : function() {
        _.bindAll(this); //allow access to 'this' in callbacks with 'this' meaning the object not the context of the callback

    },

    getWhitelist : function() {
        return this.get('whitelist')
    },

    getBlacklist : function() {
        return this.get('blacklist')
    },

    getUsername : function() {
        return this.get('username')
    },

    getResourceURI : function() {
        return this.get('resourceURI')
    },

    isLoggedIn : function() {
        if (this.getUsername() === this.defaults.username || this.getResourceURI() === this.defaults.resourceURI) {
            this.logout();
        }
        return this.get('loggedIn')
    },

    //when the user is logged in set the boolean to give logged in views.
    setLogin : function(status) {
        this.set({ 
            'loggedIn': status,
        });

        var map = {
            'true' : 'login',
            'false' : 'logout'
        };

        //loginBadge(map[status]);
    },

    login : function() {
        this.setLogin(true);
    },

    logout : function() {
        this.setLogin(false);
    },
    
    setUsername : function(username) {
        this.set({ 
            'username': username,
        });
        this.setResourceURI(username);
    },

    setResourceURI : function(username) {
        this.set({
            'resourceURI' : sprintf('/api/v1/user/%s/', username)
        })
    },

    setWhitelist : function(whitelist) {
        this.setFilterSet('whitelist', whitelist);
    },

    setBlacklist : function(blacklist) {
        this.setFilterSet('blacklist', blacklist);
    },

    setFilterSet : function(type, list) {
        this.set({
            type : list
        })
    },

    //check if a url is in the blacklist
    inBlackList : function(url) {
        return this.inSet('blacklist', url)
    },

    //check if a url is in the whitelise
    inWhitelist : function(url) {
        return this.inSet('whitelist', url)
    },

    //check if url is in a set (either whitelist or blacklist)
    // documentation for URL.js : http://medialize.github.com/URI.js/docs.html
    inSet : function(setType, url) {
        var set = this.get(setType);
        var uri = new URI(url)
        var hostname = uri.hostname();
        var protocol = uri.protocol();
        return (set.where({'url' : hostname}).length || set.where({"url" : protocol}).length || set.where(url).length)
    },

    //save the current state to local storage
    saveState : function(){
        localStorage.user = JSON.stringify(this);
    },
});


/*
    inputs:
    tabId - indentifer of tab (unique to session only)
    url - url of the tab making the request
    favIconUrl - used for displaying content
    title - title of the webpage the tab is displaying
    event_type - whether a tab is opening or closing/navigating to a new page etc
*/
function openItem(tabId, url, favIconUrl, title, event_type) {
    var timeCheck = checkTimeDelta();
    var uri = new URI(url);
    //if its not in the whitelist lets check that the user has it
    if (!user.inWhitelist(url) && !user.inBlackList(url)) {

        timeCheck.allow = false; // we need to wait for prompt callback
        chrome.tabs.sendMessage(tabId, {"action": "prompt"},function(res){
                if (res != undefined && res.prompRes == 'allow') {
                    finishOpen(tabId, url, favIconUrl, title, event_type);
                }
            });

    } else if (user.inBlackList(url)) {
        return
    } 

    if (timeCheck.allow){
        finishOpen(tabId, url, favIconUrl, title, event_type, timeCheck.time);
    }
}

function finishOpen(tabId, url, favIconUrl, title, event_type, time) {
    
    if (activeItem != undefined) {
        closeItem(activeItem.tabId, activeItem.url, 'blur', time);
    };
        
    //reassign the active item to be the current tab
    activeItem = {
        'tabId' : tabId,
        'url' : url,
        'favIconUrl' : favIconUrl,
        'title' : title,
        'start_event' : event_type,
        'start_time' : new Date(),
    };
}

/* 
    There is only ever one activeItem at a time so only close out the active one. 
    This event will be fired when a tab is closed or unfocused but we would have already 'closed' the item so we don't want to do it again.
*/
function closeItem(tabId, url, event_type, time, callback) {
    if (activeItem === undefined) return;
    var time = time || new Date(); // time is undefined for destroy event
    var callback = callback || false;
    if (activeItem.tabId === tabId && !user.inBlackList(url)) {
        //write to local storage
        var item = $.extend({}, activeItem); //copy activeItem

        item.end_event = event_type;
        item.end_time = time;
        item.total_time = item.end_time - item.start_time;
        item.humanize_time = moment.humanizeDuration(item.total_time);
        local_history.push(item);

        // send data for server and sync whitelist/blacklist
        if (local_history.length) {
            dumpData();
            user.getWhitelist().fetch();
            user.getBlacklist().fetch();   
        }
    }
    if (callback) {
        callback();
    }
}

function executeMessage(request, sender, sendResponse) {
    var message = JSON.parse(request);
    var action = message.action;
    if (action == "filterlist") {
        handleFilterListMsg(message);
    } else if (action == "idle") {
       handleIdleMsg(message, sender.tab.id);
    } else {
        console.log("Action not supported");
    }
}

function handleFilterListMsg(message) {
    var type = message.type;
    var url = message.url;
    var list;
    if (type == 'whitelist') {
        list = user.getWhitelist();
    } else if (type == 'blacklist') {
        list = user.getBlacklist();
    } else {
        return
    }
    m = list.create({
        'url' : url,
        'user' : user.getResourceURI(),
    });

    localStorage['user'] = JSON.stringify(user);
}

function handleIdleMsg(message, tabId) { 
    var type = message.type;
    if (type == 'openItem')  {
        openTab(tabId, 'focus');
    } else if (type == 'closeItem' && activeItem != undefined) { 
        closeTab(tabId, 'idle', function() {
                activeItem = undefined;
            });
    }
}

/*
    Posts data to server
*/
function dumpData() {
    var backlog = []
    var url = getApiURL('history-data');
    $.each(local_history, function(index, item){
        payload = serializePayload(item);
        $.ajax({
            type: 'POST',
            url: url,
            data: payload,
            dataType: "text",
            processData:  false,
            contentType: "application/json",
            error: function(jqXHR, textStatus, errorThrown){
                // log the error to the console
                console.log(
                    "The following error occured: "+
                    textStatus, errorThrown
                );
                backlog.push(item);
                if (index == local_history.length-1) {
                    local_history = backlog;
                }
            },
            success: function(data, textStatus, jqXHR) {
               if (index == local_history.length-1) {
                    local_history = [];
                } 
            },
        });
    });
}

/*
    checks if the time between the current event and the active item is greater than the delta. Default delta is 900ms
*/
function checkTimeDelta(delta) {
    var delta = delta || 900
    var now = new Date();
    var allow = true; // default to true allows active item to be set initially
    if (activeItem != undefined) { 
        allow = (now.getTime() - activeItem.start_time) > delta
    }

    return {
        'allow' : allow,
        'time' : now,
    }
}

function getApiURL(resource, id, params) {
    params = params || {};
    var apiBase = sprintf('%s/api/v1/%s', baseUrl, resource);
    var getParams = ''
    for (var key in params) {
      getParams += sprintf("&%s=%s", key, params[key]);
    }
    if (id != null) {
        apiBase += '/' + id;
    } 
    return apiBase
}

/////////init models///////
function loadLocalHistory() {
    localString = localStorage['local_history'];
    localString = (localString) ? localString : "[]"; // catch undefined case
    return JSON.parse(localString);
}

/*
    Get and return the user from local storage.
    If no user is found create a new one.
    If an old user exists unJSON the object and return it.
*/
function getLocalStorageUser() {
    var storedUser = localStorage.user;
    if (storedUser === undefined || storedUser === "null") {
        user = new User();
        return user
    }

    o = JSON.parse(storedUser);
    var u = new User();

    u.setUsername(o.username);
    u.setLogin(o.loggedIn);
    u.setBlacklist(o.blacklist);
    u.setWhitelist(o.whitelist);

    return u
}

/*
    Clear the local storage for the given key
*/ 
function clearLocalStorage(key) {
    localStorage[key] = null;
}

//  Check if these are already set to avoid overwriting.
function localSetIfNull(key, value) {
    if (localStorage.getItem(key) === null) {
        localStorage.setItem(key, value);
    }
}

//converts the data to JSON serialized
function serializePayload(payload) {
    payload.start_time = payload.start_time
    payload.end_time = payload.end_time
    payload.user = user.getResourceURI();
    return JSON.stringify(payload);
}

// dictionary mapping all open items. Keyed on tabIds and containing all information to be written to the log. 
// var activeItem;

// local_history = loadLocalHistory();

// user = getLocalStorageUser();
// initBadge()

localSetIfNull("baseUrl", baseUrl);




LoginView = Backbone.View.extend({
    'el' : $('.content-container'),

    initialize : function() {
        _.bindAll(this);
        this.render();
    },

    render : function() {
        if (!user.isLoggedIn()) {
            $('.content-container').empty();
            $('body').css('width', '300px');
            var template = _.template($("#login_template").html(), {
                    'baseUrl' : baseUrl,
                });

            $(this.el).html(template);
            $('#errors').fadeOut();
            $('#id_username').focus();
        }
    },

    events : {
        "click #login" : "getLogin",
        "keypress input" : "filterKey"
    },

    filterKey : function(e) {
        if (e.which === 13) { // listen for enter event
            e.preventDefault();
            this.getLogin()
        }
    },

    getLogin : function() {
        $('#errors').fadeOut();
        var self = this;
        var username = $('#id_username').val();
        var password = $('#id_password').val();
        if (username === '' || password === '') {
            self.displayErrors("Enter a username and a password")
        } else {
            $.get(url_login(), function(data) {
                self.postLogin(data, username, password);
            });
        }
    },

    postLogin : function(data, username, password) {
        var REGEX = /name\='csrfmiddlewaretoken' value\='.*'/; //regex to find the csrf token
        var match = data.match(REGEX);
        var self = this;
        if (match) {
            match = match[0]
            var csrfmiddlewaretoken = match.slice(match.indexOf("value=") + 7, match.length-1); // grab the csrf token
            //now call the server and login
            $.ajax({
                url: url_login(),
                type: "POST",
                data: {
                        "username": username,
                        "password": password,
                        "csrfmiddlewaretoken" : csrfmiddlewaretoken,
                        "remember_me": 'on', // for convenience
                },
                dataType: "html",
                success: function(data) {
                    var match = data.match(REGEX)
                    if(match) { // we didn't log in successfully
                        
                        self.displayErrors("Invalid username or password");
                    } else {
                        
                        self.completeLogin(username)
                    }
                },
                error : function(data) {
                    self.displayErrors("Unable to connect, try again later.")
                }
            });
        } else {
            self.completeLogin(username);
        }
    },

    completeLogin : function(username) {
        $('#login_container').remove();
        $('body').css('width', '400px');

        user.login();
        user.setUsername(username);
        navView.render('home_tab');
        homeView = new HomeView();
        //
        // Update user attributes in localStorage
        //
        user.getBlacklist().fetch({
            success: function (data) {
                user.saveState();
            }
        });
        user.getWhitelist().fetch({
            success: function (data) {
                user.saveState();
            }
        });
    },

    logout : function() {
        $.get(url_logout());
        user.logout();
        backpage.clearLocalStorage('user')
        this.render();
    },

    displayErrors : function(errorMsg) {
        $errorDiv = $('#errors');
        $errorDiv.html(errorMsg);
        $errorDiv.fadeIn();
    },

});

NavView = Backbone.View.extend({
    'el' : $('.nav-container'),

    initialize : function(){
        this.render('home_tab');
        $('.brand').blur()
    },

    render : function(tab) {
        $('.nav-container').empty();
        var loggedIn = user.isLoggedIn();
        var template = _.template($("#nav_template").html(), {
                baseUrl : baseUrl,
                loggedIn : loggedIn,
            });

        $(this.el).html(template);
        if (!loggedIn) {
            tab = "login_tab"
        }
        $('nav-tab').removeClass('active');
        $('#' + tab).addClass('active').click();
    },
});

HomeView = Backbone.View.extend({
    'el' : $('.content-container'),

    initialize : function(){
        this.render()
    },

    render : function() {
        if (!user.isLoggedIn()) {
            return
        }
        var template = _.template($("#splash_template").html());
        $(this.el).html(template);
    },
});

function clickHandle(e) {
    e.preventDefault();
    var url = $(e.target).context.href;
    if (url.indexOf("logout") !== -1) {
        loginView.logout();          
    } else {
        backpage.openLink(url);
    }
}

///////////////////URL BUILDERS///////////////////
function url_login() {
    return baseUrl + '/accounts/login/'
}

function url_logout() {
    return baseUrl + '/accounts/logout/'
}

$(document).ready(function() {
    user = new User();
    baseUrl = "/"
    navView =  new NavView();
    loginView = new LoginView(); // (presumably) calls initialization
    var homeView;
    if (user.isLoggedIn()){
        homeView = new HomeView();
    }
    $(document).click('#home_tab', function(){
        if (homeView != undefined) {
            homeView.render();
        }
    });
    $('a').click(clickHandle)
});