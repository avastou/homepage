angular.module("GoogleReader").factory("googleReader", ["$http", "$q", "utils", "$rootScope", "Cache", function($http, $q, utils, $rootScope, Cache){
        var apiBaseUrl = "https://www.google.com/reader/api/0/",
            clientId = "225561981539.apps.googleusercontent.com",
            redirectUri = "https://yoxigen.github.com/homepage",
            defaultSettings = {
                n: 30
            },
            readItemCategoryRegExp = /^user\/\d+\/state\/com\.google\/read$/,
            token,
            currentUser,
            cache = new Cache({
                id: "google_reader",
                hold: true,
                itemsExpireIn: 60 * 5 // cache items expire in 5 minutes
            }),
            maxItemsToCache = 30,
            cacheKey = "posts";

        function itemIsRead(item){
            if (item.categories && item.categories.length){
                for(var i= 0; i < item.categories.length; i++){
                    if (readItemCategoryRegExp.test(item.categories[i]))
                        return true;
                }
            }

            return false;
        }

        function formatItems(items){
            var formattedItems = [],
                formattedItem,
                summary;

            for(var i= 0, item; item = items[i]; i++){
                if (i && item.title === items[i - 1].title && item.published === items[i - 1].published)
                    continue;

                summary = item.summary ? item.summary.content : item.content && item.content.content;

                formattedItem = {
                    id: item.id,
                    author: item.author && item.author.replace("noreply@blogger.com", ""),
                    link: item.alternate[0].href,
                    publishDate: new Date(item.published * 1000),
                    creationDate: item.crawlTimeMsec,
                    feed: {
                        id: item.origin.streamId,
                        url: item.origin.htmlUrl,
                        title: utils.strings.stripHtml(item.origin.title)
                    },
                    title: utils.strings.stripHtml(item.title),
                    summary: utils.strings.trim(utils.strings.stripHtml(summary), 150, "..."),
                    text: item.content ? item.content.content : item.summary && item.summary.content,
                    isRead: itemIsRead(item),
                    isFullContent: !!item.content,
                    direction: item.content ? item.content.direction : item.summary && item.summary.direction
                };

                var temp = document.createElement("div"),
                    images;

                temp.innerHTML = formattedItem.text;
                images = temp.querySelectorAll("img");
                for(var imageIndex= 0, img; (img = images[imageIndex]) && !formattedItem.image; imageIndex++){
                    if (img && /\.(png|jpg)$/.test(img.src))
                        formattedItem.image = {
                            src: img.src,
                            title: img.title
                        };
                }


                formattedItems.push(formattedItem);
            };

            return formattedItems;
        }

        function getStorageToken(){
            return token = sessionStorage.getItem("reader_token");
        }

        var methods = {
            get isAuthorized(){
                return token || getStorageToken();
            },
            getCurrentUser: function(){
                var deferred = $q.defer();

                if (currentUser){
                    deferred.resolve(currentUser);
                    return deferred.promise;
                }

                $http.get(apiBaseUrl + "user-info?client=" + clientId)
                    .success(function(response){
                        currentUser = response;
                        deferred.resolve(response);
                    })
                    .error(function(error){
                        deferred.reject(error);
                    });

                return deferred.promise;
            },
            login: function(){
                var deferred = $q.defer();

                methods.logout();

                var googleOauth2Url = "https://accounts.google.com/o/oauth2/auth?response_type=token&client_id=" + clientId +
                    "&scope=" + encodeURIComponent("http://www.google.com/reader/api/*") + "&state=reader&redirect_uri=" +
                    encodeURIComponent("https://yoxigen.github.com/homepage");

                chrome.tabs.getCurrent(function(currentTab){
                    chrome.tabs.create({ url: googleOauth2Url }, function(authTab){
                        function onRemoved(tabId){
                            if (tabId === authTab.id){
                                deferred.reject();
                                $rootScope.$apply();
                                chrome.tabs.onRemoved.removeListener(onRemoved);
                                chrome.tabs.onUpdated.removeListener(onUpdated);
                            }
                        }

                        function onUpdated(tabId, changeInfo, tab) {
                            if (tabId === authTab.id && tab.url.indexOf(redirectUri) === 0){
                                auth = {
                                    token: tab.url.match(/access_token=([^&#]+)/)[1],
                                    expires: new Date().valueOf() + parseInt(tab.url.match(/expires_in=(\d+)/)[1], 10) * 1000
                                };

                                chrome.tabs.onRemoved.removeListener(onRemoved);
                                chrome.tabs.onUpdated.removeListener(onUpdated);
                                chrome.tabs.remove(tabId);

                                $http.get(apiBaseUrl + "token")
                                    .success(function(apiToken){
                                        token = apiToken;
                                        deferred.resolve(auth);
                                        //$rootScope.$apply();
                                        sessionStorage.setItem("reader_token", apiToken);
                                    })

                                chrome.tabs.update(currentTab.id, { active: true });
                            }
                        }

                        chrome.tabs.onUpdated.addListener(onUpdated);
                        chrome.tabs.onRemoved.addListener(onRemoved);
                    });
                });

                return deferred.promise;
            },
            logout: function(){
                token = null;
                sessionStorage.removeItem("reader_token");
            },
            getItems: function(params, forceRefresh){
                var deferred = $q.defer(),
                    cachePosts;

                if (forceRefresh)
                    cache.removeItem(cacheKey);
                else if (!params){
                    cachePosts = cache.getItem(cacheKey, { hold: true });
                    if (cachePosts)
                        deferred.resolve(cachePosts)
                }

                if (!cachePosts){
                    $http.get(apiBaseUrl + "stream/contents/user/-/state/com.google/reading-list", { params: angular.extend({}, defaultSettings, params) })
                        .success(function(readerData){
                            var returnData = {
                                paging: { c: readerData.continuation },
                                items: formatItems(readerData.items)
                            };

                            deferred.resolve(returnData);

                            var cacheData = cache.data[cacheKey];

                            if (!cacheData){
                                cache.setItem(cacheKey, returnData, { hold: true })
                            }
                            else if (params.ot){ // newer items
                                cacheData.items = returnData.items.concat(cacheData.items);
                                cacheData.items = cacheData.items.slice(0, maxItemsToCache);
                                cache.setItem(cacheKey, cacheData, { hold: true });
                            }
                            else if (cacheData.items.length + returnData.items.length <= maxItemsToCache){
                                cacheData.items = cacheData.items.concat(returnData.items);
                                cacheData.paging = returnData.paging;
                                cache.setItem(cacheKey, cacheData, { hold: true });
                            }
                        })
                        .error(function(e){
                            deferred.reject(e);
                        });
                }

                return deferred.promise;
            },
            markAsRead: function(item){
                if (item.isRead)
                    return false;

                methods.getCurrentUser().then(function(user){
                    $http({ method: "POST", url: apiBaseUrl + "edit-tag?client=" + clientId, params: {
                        T: token,
                        a: "user/-/state/com.google/read",
                        s: item.feed.id,
                        async: true,
                        i: item.id
                    }}).success(function(){
                            item.isRead = true;
                        });
                });
            },
            refresh: function(options){
                if (!options || !options.lastItem)
                    return methods.getItems();

                var lastItemDate = Number(options.lastItem.creationDate);
                lastItemDate = Math.round(lastItemDate / 1000) + 1;
                return methods.getItems({ ot: lastItemDate });
            }
        };

        return methods;
    }]);