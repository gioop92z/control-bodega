import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8')
  .replace(/^import .*;\s*$/gm,'')
  .replace(/\nboot\(\);\s*$/,'');

function harness({currentUser=null,loginError=null,online=true}={}){
  let user=currentUser;
  const calls=[],storage=new Map(),nodes=new Map();
  const button={disabled:false,textContent:'Entrar'};
  const form={querySelector:()=>button};
  const app={innerHTML:''};
  nodes.set('app',app);
  nodes.set('clave',{value:''});
  nodes.set('loginForm',form);
  nodes.set('loginMsg',{innerHTML:''});
  const sessionStorage={
    getItem:key=>storage.get(key)||null,
    setItem:(key,value)=>storage.set(key,String(value)),
    removeItem:key=>storage.delete(key)
  };
  const sb={
    auth:{
      async getUser(){calls.push('getUser');return {data:{user},error:null};},
      async signOut(){calls.push('signOut');user=null;return {error:null};},
      async signInWithPassword(credentials){
        calls.push({action:'signInWithPassword',email:credentials.email});
        if(loginError)return {error:loginError};
        user={id:'seller-account',email:credentials.email};
        return {data:{user},error:null};
      }
    }
  };
  let reloads=0;
  const sandbox={
    createClient:()=>sb,
    vantisBackendConfig:{url:'https://example.invalid',key:'test-key',mode:'LEGACY_PRODUCCION'},
    console,crypto,AbortController,clearTimeout,clearInterval,
    setTimeout:()=>0,
    document:{getElementById:id=>nodes.get(id)||null,querySelectorAll:()=>[]},
    window:{},
    navigator:{onLine:online},
    sessionStorage,
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    location:{reload(){reloads++}}
  };
  vm.runInNewContext(source+'\nglobalThis.testApi={renderLogin,doLogin,boot,roleFromUser};',sandbox);
  const api=sandbox.testApi;
  return {app,form,button,nodes,calls,storage,sessionStorage,api,get reloads(){return reloads}};
}
function submitted(h,number){
  h.nodes.get('clave').value=number;
  return h.api.doLogin({preventDefault(){},submitter:h.button});
}

test('login shows ONE employee-number field, with no PIN or role option',()=>{
  const h=harness();
  h.api.renderLogin();
  assert.match(h.app.innerHTML,/>Número de empleado</);
  assert.equal((h.app.innerHTML.match(/<input\b/g)||[]).length,1);
  assert.doesNotMatch(h.app.innerHTML,/id="pin"|PIN|contraseña|Código de seguridad|Administrador|Vendedor general/i);
  assert.equal(h.form.onsubmit,h.api.doLogin);
});

test('eight-digit operator ID enters through seller-only session, without supplying PIN',async()=>{
  const h=harness();
  h.api.renderLogin();
  await submitted(h,'16647310');
  const signIns=h.calls.filter(x=>typeof x==='object');
  assert.equal(signIns.length,1);
  assert.equal(signIns[0].email,'10@bodega.local');
  assert.equal(h.sessionStorage.getItem('nova.employeeNumber'),'16647310');
  assert.equal(h.reloads,1);
});

test('old 99 admin shortcut cannot grant administrator access',async()=>{
  const h=harness({currentUser:{email:'99@bodega.local'}});
  h.api.renderLogin();
  await submitted(h,'16647310');
  assert.equal(h.calls.filter(x=>typeof x==='object')[0].email,'10@bodega.local');
  assert.ok(h.calls.includes('signOut'));
  assert.equal(h.reloads,1);
});

test('short code 99 never logs in or reuses legacy administrator PIN',async()=>{
  const h=harness();
  h.api.renderLogin();
  await submitted(h,'99');
  assert.equal(h.calls.filter(x=>typeof x==='object').length,0);
  assert.match(h.nodes.get('loginMsg').innerHTML,/número de empleado válido/);
  assert.equal(h.reloads,0);
});

test('server login failure does not falsely say that employee was admitted',async()=>{
  const h=harness({loginError:{message:'Invalid credentials'}});
  h.api.renderLogin();
  await submitted(h,'16647310');
  assert.equal(h.sessionStorage.getItem('nova.employeeNumber'),null);
  assert.equal(h.reloads,0);
  assert.equal(h.button.disabled,false);
  assert.match(h.nodes.get('loginMsg').innerHTML,/<div class="error">.+<\/div>/);
});

test('existing administrator sessions are redirected to employee sign-in',async()=>{
  const h=harness({currentUser:{email:'99@bodega.local'}});
  await h.api.boot();
  assert.match(h.app.innerHTML,/Número de empleado/);
  assert.doesNotMatch(h.app.innerHTML,/id="pin"/);
  assert.ok(h.calls.includes('signOut'));
});
