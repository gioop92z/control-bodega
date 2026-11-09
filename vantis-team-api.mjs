// Shared-inventory adapter for the existing ContinuousReceive engine.
import {TEAM_API_URL} from './team-config.mjs';
export const TEAM_DEPARTMENT='ZAPATERIA INFANTIL';
const BASE=String(TEAM_API_URL||'').trim().replace(/\/+$/,'');
export const teamConfigured=()=>/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(BASE);
export class TeamInventoryApi {
  constructor(token,onUnauthorized=()=>{}) {
    if(!teamConfigured())throw Error('No se configuró el servidor compartido de VANTIS.');
    this.token=token;this.onUnauthorized=onUnauthorized;
    this.acceptAnyNumericCode=true;this.mode='team';this.deptId=TEAM_DEPARTMENT;
  }
  async request(path,{method='GET',body}={}){
    let response;
    try{
      response=await fetch(BASE+path,{method,cache:'no-store',
        headers:{'authorization':'Bearer '+this.token,...(body?{'content-type':'application/json'}:{})},
        body:body?JSON.stringify(body):undefined});
    }catch{throw Object.assign(Error('No hay conexión con el inventario central. La lectura se conserva para reintentar.'),{code:'NETWORK_ERROR'});}
    const value=await response.json().catch(()=>({error:'Respuesta inesperada del servidor.'}));
    if(!response.ok){
      if(response.status===401)this.onUnauthorized();
      throw Object.assign(Error(value.error||'Error al consultar VANTIS.'),{code:response.status===401?'jwt_expired':(value.code||'REMOTE_ERROR'),status:response.status});
    }
    return value;
  }
  capabilities(){return this.request('/api/capabilities');}
  activate(code){return this.request('/api/labels',{method:'POST',body:{code}});}
  async lookup(codes){
    const rows=await this.request('/api/catalog?codes='+encodeURIComponent(codes.join(',')));
    return new Map(rows.map(row=>[row.code,{product:row.product}]));
  }
  ensureProduct(code){return this.request('/api/products',{method:'POST',body:{code}});}
  receive(payload){return this.request('/api/receipts',{method:'POST',body:payload});}
  summary(){return this.request('/api/summary');}
  search(q){return this.request('/api/search?q='+encodeURIComponent(q));}
  history(){return this.request('/api/history?limit=70');}
  people(){return this.request('/api/people');}
  addPerson(payload){return this.request('/api/people',{method:'POST',body:payload});}
  updatePerson(payload){return this.request('/api/people',{method:'PATCH',body:payload});}
  describe(payload){return this.request('/api/products/describe',{method:'PATCH',body:payload});}
}
export async function setupTeamAdmin({key,employee,name,pin}){
  if(!teamConfigured())throw Error('Servidor compartido sin configurar.');
  const response=await fetch(BASE+'/api/bootstrap',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({key,employee,name,pin})}).catch(()=>{throw Error('No se pudo conectar con el servidor.');});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.error||'No se pudo activar la cuenta.');
  return result;
}
export async function openTeamSession(employee,pin){
  if(!teamConfigured())throw Error('No se configuró el servidor compartido de VANTIS.');
  const response=await fetch(BASE+'/api/login',{method:'POST',cache:'no-store',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({employee,pin})}).catch(()=>{throw Error('No se pudo conectar con el servidor de VANTIS.');});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.error||'No fue posible iniciar sesión.');
  if(!['admin','scanner','viewer'].includes(result.role)||!result.token)throw Error('Sesión inválida.');
  return result;
}
