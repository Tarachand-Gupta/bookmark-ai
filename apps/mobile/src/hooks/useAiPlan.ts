import {useCallback,useState} from 'react';
import type {AiMode} from '@bookmark-ai/types';
import {getAccount,getSettings,updateSettings} from '../api';
import {useCachedResource} from './useCachedResource';
export function useAiPlan(){
 const account=useCachedResource('account',getAccount),settings=useCachedResource('settings',getSettings);
 const [saving,setSaving]=useState(false),[saveError,setSaveError]=useState<string|null>(null);
 const setAiMode=useCallback((mode:AiMode)=>{if(settings.readOnly||settings.error){setSaveError('Reconnect and restore sign-in before changing AI settings.');return;}if(saving||!settings.data||settings.data.settings.aiMode===mode)return;setSaving(true);setSaveError(null);void updateSettings({aiMode:mode}).then(settings.replace).catch(e=>setSaveError(e.message)).finally(()=>setSaving(false));},[settings.readOnly,settings.error,settings.data,settings.replace,saving]);
 return {plan:account.data?.plan??'free' as const,settings:settings.data?.settings??null,loading:account.loading||settings.loading,error:account.error??settings.error,saving,saveError,setAiMode,updatedAt:settings.updatedAt,readOnly:settings.readOnly,refreshing:settings.refreshing,reload:()=>{account.refresh();settings.refresh()}};
}
export type AiPlanState=ReturnType<typeof useAiPlan>;
