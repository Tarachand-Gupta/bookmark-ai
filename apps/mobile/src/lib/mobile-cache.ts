import AsyncStorage from '@react-native-async-storage/async-storage';
import {createSnapshotCache} from './snapshot-cache';
import {createLargeSnapshotStorage} from './large-snapshot-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
const directory=`${FileSystem.documentDirectory}bookmark-snapshots/`;
export const mobileCache=createSnapshotCache(createLargeSnapshotStorage(AsyncStorage,{
 read:name=>FileSystem.readAsStringAsync(`${directory}${name}`),
 write:async(name,value)=>{if(!FileSystem.documentDirectory)throw new Error('Device storage is unavailable.');await FileSystem.makeDirectoryAsync(directory,{intermediates:true});await FileSystem.writeAsStringAsync(`${directory}${name}`,value)},
 remove:name=>FileSystem.deleteAsync(`${directory}${name}`,{idempotent:true}),
},Crypto.randomUUID));
