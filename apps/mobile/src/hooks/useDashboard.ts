import {getDashboard} from '../api';
import {useCachedResource} from './useCachedResource';
export function useDashboard(active:boolean){return useCachedResource('dashboard',getDashboard,active);}
