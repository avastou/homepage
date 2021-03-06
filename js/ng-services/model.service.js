angular.module("HomepageModel", ["Storage", "Utils", "EventBus"]).factory("model", ["$q", "$http", "Storage", "utils", "EventBus", "$timeout",
    function($q, $http, Storage, utils, EventBus, $timeout){
    var defaultModelUrl = "js/data/default_model.json",
        defaultLayoutUrl = "js/data/layout.json",
        model,
        storage = new Storage("homepageModel"),
        storageKeys = {
            LAYOUT_STORAGE_KEY: "homepage_layout",
            MODEL_STORAGE_KEY: "homepage_model",
            SETTINGS_STORAGE_KEY: "homepage_settings"
        },
        storageSettings,
        storageModel,
        storageLayout,
        eventBus = new EventBus(),
        setLayoutTimeoutPromise;

    function getModelData (){
        var deferred = $q.defer();

        $q.all([storage.cloud.getItem(storageKeys.MODEL_STORAGE_KEY), storage.cloud.getItem(storageKeys.SETTINGS_STORAGE_KEY)]).then(function(data){
            storageModel = data[0];
            storageSettings = data[1] || {};
            if (storageModel){
                deferred.resolve(angular.copy(storageModel));
            }
            else{
                $http.get(defaultModelUrl).then(function(defaultModel){
                    storageModel = defaultModel.data;
                    deferred.resolve(angular.copy(defaultModel.data));
                }, function(error){
                    deferred.reject(error);
                });
            }
        }, function(error){
            console.error(error);
        });

        return deferred.promise;
    }

    function applyStorageSettingsToModel(model){
        var modelStorageSettings = storageSettings[model.id];
        if (modelStorageSettings){
            if (!model.settings)
                model.settings = modelStorageSettings;
            else
                angular.extend(model.settings, modelStorageSettings);
        }
    }

    function getModuleFilePath(moduleType, moduleName, file){
        return ["modules", moduleType, moduleName, file].join("/");
    }

    function getUniqueModuleId(){
        var randomStr = utils.strings.getRandomString(6),
            moduleType,
            idExists = false;

        for(var moduleTypeName in storageModel){
            moduleType = storageModel[moduleTypeName];
            moduleType.every(function(module){
                if (module.id === randomStr){
                    idExists = true;
                    return false;
                }
                return true;
            });

            if (idExists)
                break;
        }

        if (idExists)
            randomStr = getUniqueModuleId();

        return randomStr;
    }

    function getMostAvailableColumn(){
        var mostAvailableColumn;
        storageLayout.rows.forEach(function(row){
            row.columns.forEach(function(column){
                if (!mostAvailableColumn || column.widgets.length < mostAvailableColumn.widgets.length)
                    mostAvailableColumn = column;
            })
        });

        return mostAvailableColumn;
    }

    return {
        addModule: function(type, moduleType){
            var module = { type: moduleType, id: getUniqueModuleId() };

            storageModel[type].push(module);

            if (type === "widgets"){
                var column = getMostAvailableColumn();
                column.widgets.push({ id: module.id });
                column.widgets.forEach(function(widget){
                    delete widget.height;
                });
            }
            this.getModel(angular.copy(storageModel)).then(function(modulesData){
                var module = modulesData[type][modulesData[type].length - 1];
                    resources = [];

                if (module.resources){
                    module.resources.forEach(function(resource){
                        resources.push(getModuleFilePath(type, module.type, resource));
                    })
                }

                if (module.modules){
                    module.modules.forEach(function(ngModule){
                        angular.module(ngModule.name, ngModule.dependencies || []);
                    })
                }

                requirejs(resources, function() {
                    //self.destroy();
                    //angular.bootstrap(document, ["Homepage"]);
                    eventBus.triggerEvent("onModelChange", { added: { type: type, module: module }, model: modulesData, layout: storageLayout });
                });
                //eventBus.triggerEvent("onModelChange", { added: { type: type, module:  }, model: modulesData, layout: storageLayout });
            });

            $q.all([
                storage.cloud.setItem(storageKeys.MODEL_STORAGE_KEY, storageModel),
                storage.cloud.setItem(storageKeys.LAYOUT_STORAGE_KEY, storageLayout)
            ]).then(function(){ console.log("SAVED MODELS!") });
        },
        destroy: function(){
            storage.destroy();
            storage = null;
            model = null;
        },
        getLayout: function(){
            var deferred = $q.defer();

            storage.cloud.getItem(storageKeys.LAYOUT_STORAGE_KEY).then(function(layoutData){
                if (layoutData){
                    storageLayout = layoutData;
                    deferred.resolve(angular.copy(layoutData));
                }
                else{
                    $http.get(defaultLayoutUrl)
                        .success(function(data){
                            storageLayout = data;
                            deferred.resolve(angular.copy(data));
                        })
                        .error(function(error){
                            deferred.reject(error);
                        });
                }
            }, deferred.reject)

            return deferred.promise;
        },
        getModel: function(modelData){
            var deferred = $q.defer(),
                manifestsPromises = [];

            function loadManifest(module, moduleType){
                var deferred = $q.defer();

                $http.get(getModuleFilePath(moduleType, module.type, module.type + ".manifest.json"))
                    .success(function(manifest){
                        if (manifest.html){
                            angular.forEach(manifest.html, function(html, key){
                                manifest.html[key] = ["modules", moduleType, module.type, html].join("/");
                            });
                        }

                        if (manifest.icon && !/^https?:\/\//.test(manifest.icon))
                            manifest.icon = ["modules", moduleType, module.type, manifest.icon].join("/");

                        if (module.settings)
                            angular.extend(manifest.settings, module.settings);

                        angular.extend(module, manifest);
                        applyStorageSettingsToModel(module);

                        deferred.resolve(module);
                    })
                    .error(function(error){
                        deferred.reject(error);
                    });

                manifestsPromises.push(deferred.promise);
            }

            function withModelData(modelData){
                angular.forEach(modelData, function(type, typeName){
                    angular.forEach(type, function(module){
                        if (angular.isArray(module)){
                            angular.forEach(module, function(module){
                                loadManifest(module, typeName);
                            });
                        }
                        else
                            loadManifest(module, typeName);
                    });
                });

                $q.all(manifestsPromises).then(function(){
                    model = modelData;
                    deferred.resolve(modelData);
                });
            }

            if (modelData)
                withModelData(modelData);
            else
                getModelData().then(withModelData);

            return deferred.promise;
        },
        getUsedModuleTypes: function(){
            var deferred = $q.defer();

            var usedModuleIds = [];
            angular.forEach(storageModel, function(moduleType){
                moduleType.forEach(function(module){
                    usedModuleIds.push(module.type);
                })
            });

            deferred.resolve(usedModuleIds);
            return deferred.promise;
        },
        onModelChange: eventBus.getEventPair("onModelChange"),
        removeModule: function(moduleToRemove){
            // Remove the module from model
            var foundModule,
                moduleType,
                promises = [];

            for(var moduleTypeName in storageModel){
                moduleType = storageModel[moduleTypeName];
                for(var i= 0, module; module = moduleType[i]; i++){
                    if (module.id === moduleToRemove.id){
                        moduleType.splice(i, 1);
                        foundModule = true;
                        break;
                    }
                }
                if (foundModule)
                    break;
            };

            promises.push(storage.cloud.setItem(storageKeys.MODEL_STORAGE_KEY, storageModel));

            if (storageSettings[moduleToRemove.id]){
                delete storageSettings[moduleToRemove.id];
                promises.push(storage.cloud.setItem(storageKeys.SETTINGS_STORAGE_KEY, storageSettings));
            }

            if (moduleTypeName === "widgets"){
                // Remove module from layout and use the freed space in other modules
                foundModule = false;
                storageLayout.rows.every(function(row){
                    row.columns.every(function(column){
                        column.widgets.every(function(widget, widgetIndex){
                            if (widget.id === moduleToRemove.id){
                                var leftOverHeight = 100 - (parseFloat(widget.height) || (100 / column.widgets.length)),
                                    remainingWidgetsHeightRatio = 100 / leftOverHeight;

                                column.widgets.splice(widgetIndex, 1);
                                column.widgets.forEach(function(widget){
                                    widget.height = (parseFloat(widget.height) * remainingWidgetsHeightRatio) + "%";
                                });
                                foundModule = true;
                            }
                            return !foundModule;
                        });
                        return !foundModule;
                    });
                    return !foundModule;
                });

                promises.push(storage.cloud.setItem(storageKeys.LAYOUT_STORAGE_KEY, storageLayout));
            }

            $q.all(promises).then(function(){ console.log("SAVED MODELS!") });
        },
        saveSettings: function(settingsData){
            var settings = {};

            for(var namespace in settingsData){
                settingsData[namespace].forEach(function(module){
                    settings[module.id] = module.settings;
                });
            }

            return storage.cloud.setItem(storageKeys.SETTINGS_STORAGE_KEY, settings);
        },
        setLayout: function(layout, refreshLayout){
            $timeout.cancel(setLayoutTimeoutPromise);
            setLayoutTimeoutPromise = $timeout(function(){
                var newStorageLayout = { rows: [] };
                layout.rows.forEach(function(row){
                    var rowData = { columns: [] };
                    row.columns.forEach(function(column){
                        var columnData = { widgets: [] };
                        column.widgets.forEach(function(widget){
                            var widgetData = { id: widget.id, height: widget.height };
                            columnData.widgets.push(widgetData);
                        })
                        rowData.columns.push(columnData);
                    })
                    newStorageLayout.rows.push(rowData);
                });

                storage.cloud.setItem(storageKeys.LAYOUT_STORAGE_KEY, storageLayout = newStorageLayout);
            }, 500);
        }
    }
}]);