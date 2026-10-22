import {createContext} from 'react';
/** Available surface width; the native window may also contain an AI pane. */
export const ContentWidthContext=createContext<number|null>(null);
