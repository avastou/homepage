angular.module("GoogleFeed", []).factory("rss", ["$http", "$q", "utils", "Cache", function($http, $q, utils, Cache){
    var cache = new Cache({
            id: "rss",
            itemsExpireIn: 60 * 5 // cache items expire in 5 minutes
        }),
        defaultOptions = {
            count: 5
        };

    function loadFeed(feedUrl, forceRefresh, options){
        var deferred = $q.defer(),
            cachedData;

        if (!forceRefresh)
            cachedData = cache.getItem(feedUrl);

        if (cachedData){
            deferred.resolve(cachedData);
        }
        else{
            $http.get("https://ajax.googleapis.com/ajax/services/feed/load?v=1.0&num=" + (options.count || defaultOptions.count) +"&q=" + encodeURIComponent(feedUrl))
                .success(function(response){
                    if (!response.responseData){
                        deferred.reject({ error: response.responseDetails })
                    }
                    else{
                        response.responseData.feed.items = formatItems(response.responseData.feed.entries);
                        delete response.responseData.feed.entries;
                        deferred.resolve(response.responseData.feed);

                        cache.setItem(feedUrl, response.responseData.feed);
                    }
                })
                .error(function(error){
                    deferred.reject(error);
                });
        }

        return deferred.promise;
    }

    function formatItems(items){
        var formattedItems = [],
            formattedItem;

        for(var i= 0, item; item = items[i]; i++){
            formattedItem = {
                author: item.author,
                link: item.link,
                publishDate: new Date(item.publishedDate),
                title: item.title,
                text: utils.strings.stripHtml(item.content),
                summary: utils.strings.stripHtml(item.content),
                isRead: false,
                direction: utils.strings.getDirection(item.content)
            };

            var temp = document.createElement("div"),
                images;

            temp.innerHTML = item.content;
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

    var methods = {
        load: function(feedUrls, forceRefresh, options){
            var feeds = angular.isArray(feedUrls) ? feedUrls : [feedUrls],
                promises = [];

            angular.forEach(feeds, function(feed){
                promises.push(loadFeed(feed, forceRefresh, options));
            });

            return $q.all(promises);
        }
    };

    return methods;
}]);