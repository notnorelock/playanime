import type {
    StateTree,
    StoreDefinition,
    _ActionsTree,
    _GettersTree,
} from 'pinia';
import { defineStore } from 'pinia';

// Define initialization status types
type InitStatus = 'pending' | 'initializing' | 'success' | 'error';

// Enhanced initializer store with more detailed state tracking
const useStoreInitializer = defineStore('store-initializer', {
    state: () => ({
        initStates: {} as Record<string, {
            status: InitStatus,
            error?: any,
            timestamp?: number
        }>,
    }),
    getters: {
        isInitialized: (state) => (key: string) =>
            state.initStates[key]?.status === 'success',

        isPending: (state) => (key: string) =>
            state.initStates[key]?.status === 'pending',

        isInitializing: (state) => (key: string) =>
            state.initStates[key]?.status === 'initializing',

        hasError: (state) => (key: string) =>
            state.initStates[key]?.status === 'error',

        getError: (state) => (key: string) =>
            state.initStates[key]?.error,

        getInitTimestamp: (state) => (key: string) =>
            state.initStates[key]?.timestamp,
    },
    actions: {
        setInitializing(key: string) {
            this.initStates[key] = { status: 'initializing' };
        },

        setInitialized(key: string) {
            this.initStates[key] = {
                status: 'success',
                timestamp: Date.now()
            };
        },

        setError(key: string, error: any) {
            this.initStates[key] = {
                status: 'error',
                error,
                timestamp: Date.now()
            };
        },

        resetInitState(key: string) {
            this.initStates[key] = { status: 'pending' };
        },

        clearAllStates() {
            this.initStates = {};
        }
    },
});

// Options for initialization behavior
export interface InitOptions {
    // If true, will force reinitialization even if already initialized
    force?: boolean;
    // Timeout in milliseconds for initialization
    timeout?: number;
    // If true, will throw errors instead of catching them
    throwErrors?: boolean;
    // If set, will automatically reinitialize after this many milliseconds
    refreshInterval?: number;
}

// Default options
const defaultInitOptions: InitOptions = {
    force: false,
    timeout: 30000,
    throwErrors: false,
    refreshInterval: undefined
};

// Store instances cache
const storeInstances = new Map();
// Store initialization intervals for cleanup
const initIntervals = new Map<string, number>();

// Enhanced initializable store with async initialization support and singleton pattern
export function useInitializableStore<
    Id extends string,
    S extends StateTree,
    G extends _GettersTree<S>,
    A extends _ActionsTree,
>(storeDefinition: StoreDefinition<Id, S, G, A>, defaultOptions?: InitOptions) {
    const mergedDefaultOptions = { ...defaultInitOptions, ...defaultOptions };
    const storeId = storeDefinition.$id;

    const obj = function (initOptions?: InitOptions) {
        const options = { ...mergedDefaultOptions, ...initOptions };

        // Check if we already have an instance of this store
        if (!storeInstances.has(storeId)) {
            // Create the store instance
            const store = storeDefinition();
            const storeInitializer = useStoreInitializer();

            // Access the initialization methods with type safety 
            const anyStore = store as any;
            const initFunction = anyStore['initialize'] || anyStore['init'];

            // Setup automatic refresh if interval is specified
            if (options.refreshInterval && !initIntervals.has(storeId)) {
                const intervalId = window.setInterval(() => {
                    initializeStore(true);
                }, options.refreshInterval);

                initIntervals.set(storeId, intervalId);

                // Cleanup interval when store is no longer needed
                if (typeof window !== 'undefined') {
                    window.addEventListener('beforeunload', () => {
                        clearInterval(initIntervals.get(storeId));
                        initIntervals.delete(storeId);
                    });
                }
            }

            // Handle async initialization
            const initializeStore = async (forceInit = false) => {
                // Skip if already initialized and not forced
                if (storeInitializer.isInitialized(storeId) && !options.force && !forceInit) {
                    return store;
                }

                // Skip if currently initializing
                if (storeInitializer.isInitializing(storeId)) {
                    return store;
                }

                if (typeof initFunction === 'function') {
                    storeInitializer.setInitializing(storeId);

                    try {
                        // Create timeout promise if timeout option is set
                        const initPromise = initFunction();

                        if (initPromise instanceof Promise) {
                            // Handle async initialization with timeout
                            if (options.timeout) {
                                const timeoutPromise = new Promise((_, reject) => {
                                    setTimeout(() => reject(new Error(`Store initialization timed out after ${options.timeout}ms`)),
                                        options.timeout);
                                });

                                await Promise.race([initPromise, timeoutPromise]);
                            } else {
                                await initPromise;
                            }
                        }

                        storeInitializer.setInitialized(storeId);
                    } catch (error) {
                        storeInitializer.setError(storeId, error);
                        if (options.throwErrors) {
                            throw error;
                        }
                        console.error(`Error initializing store ${storeId}:`, error);
                    }
                } else {
                    // No initialization function found, mark as initialized
                    storeInitializer.setInitialized(storeId);
                }

                return store;
            };

            // Add utility methods to store
            anyStore.$reinitialize = () => initializeStore(true);
            anyStore.$resetInitState = () => storeInitializer.resetInitState(storeId);
            anyStore.$initStatus = {
                get isInitialized() { return storeInitializer.isInitialized(storeId); },
                get isInitializing() { return storeInitializer.isInitializing(storeId); },
                get hasError() { return storeInitializer.hasError(storeId); },
                get error() { return storeInitializer.getError(storeId); },
                get timestamp() { return storeInitializer.getInitTimestamp(storeId); }
            };

            // Cache the store instance
            storeInstances.set(storeId, {
                store,
                initializeStore
            });

            // Start initialization only once
            initializeStore();
        }

        // Return the cached store instance
        const { store } = storeInstances.get(storeId);
        return store;
    };

    obj.$id = storeDefinition.$id;

    // Add a method to reset cached instances - useful for testing
    obj.$resetInstances = () => {
        if (storeInstances.has(storeId)) {
            storeInstances.delete(storeId);
        }

        if (initIntervals.has(storeId)) {
            clearInterval(initIntervals.get(storeId));
            initIntervals.delete(storeId);
        }
    };

    return obj as StoreDefinition<Id, S, G, A> & {
        (options?: InitOptions): ReturnType<StoreDefinition<Id, S, G, A>> & {
            $reinitialize: () => Promise<ReturnType<StoreDefinition<Id, S, G, A>>>;
            $resetInitState: () => void;
            $initStatus: {
                isInitialized: boolean;
                isInitializing: boolean;
                hasError: boolean;
                error: any;
                timestamp?: number;
            };
        },
        $resetInstances: () => void;
    };
}