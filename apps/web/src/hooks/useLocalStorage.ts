import type * as Schema from "effect/Schema";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import {
  decodeLocalStorageValue,
  dispatchLocalStorageChange,
  getLocalStorageItem,
  LOCAL_STORAGE_CHANGE_EVENT,
  type LocalStorageChangeDetail,
  LocalStorageOperationError,
  readLocalStorageValue,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "../lib/localStorageItem";

export function useLocalStorage<T, E>(
  key: string,
  initialValue: T,
  schema: Schema.Codec<T, E>,
): [T, (value: T | ((val: T) => T)) => void] {
  const getSnapshot = useCallback(() => {
    try {
      return readLocalStorageValue(key);
    } catch (error) {
      console.error("[LOCALSTORAGE] Could not read stored value.", error);
      return null;
    }
  }, [key]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const handleStorageChange = (event: StorageEvent) => {
        if (event.key === key) {
          onStoreChange();
        }
      };
      const handleLocalChange = (event: CustomEvent<LocalStorageChangeDetail>) => {
        if (event.detail.key === key) {
          onStoreChange();
        }
      };

      window.addEventListener("storage", handleStorageChange);
      window.addEventListener(LOCAL_STORAGE_CHANGE_EVENT, handleLocalChange as EventListener);
      return () => {
        window.removeEventListener("storage", handleStorageChange);
        window.removeEventListener(LOCAL_STORAGE_CHANGE_EVENT, handleLocalChange as EventListener);
      };
    },
    [key],
  );

  const serializedValue = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const storedValue = useMemo(() => {
    if (serializedValue === null) {
      return initialValue;
    }
    try {
      return decodeLocalStorageValue(key, schema, serializedValue);
    } catch (error) {
      console.error("[LOCALSTORAGE] Could not decode stored value.", error);
      return initialValue;
    }
  }, [initialValue, key, schema, serializedValue]);

  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      try {
        const currentValue = getLocalStorageItem(key, schema) ?? initialValue;
        let valueToStore: T;
        if (typeof value === "function") {
          try {
            valueToStore = (value as (val: T) => T)(currentValue);
          } catch (cause) {
            throw new LocalStorageOperationError({
              operation: "update",
              storageKey: key,
              cause,
            });
          }
        } else {
          valueToStore = value;
        }
        if (valueToStore === null) {
          removeLocalStorageItem(key);
        } else {
          setLocalStorageItem(key, valueToStore, schema);
        }
        dispatchLocalStorageChange(key);
      } catch (error) {
        console.error("[LOCALSTORAGE] Could not update stored value.", error);
      }
    },
    [initialValue, key, schema],
  );

  return [storedValue, setValue];
}
