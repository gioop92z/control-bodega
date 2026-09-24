import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {EMPLOYEES} from './employees.js';
import {startScanner,stopScanner} from './scanner.js';
window.B={sb:createClient('https://dkqovohxkxlcccvagpij.supabase.co','sb_publishable_iz06RtaObND0dWOpuX2vKg_wZVbrZCv',{auth:{persistSession:true,autoRefreshToken:true}}),EMPLOYEES,startScanner,stopScanner,S:null,tab:'scan',prod:null,locs:[],tipo:'ENTRADA',lastMsg:'',busy:false};
await import('./core.js');
await import('./scan.js');
await import('./locations.js');
B.boot();
