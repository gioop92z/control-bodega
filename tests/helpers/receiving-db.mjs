import {lookupSupportCodes} from '../../support-batch.mjs';
import {supportDb} from './support-db.mjs';

export function durableMemory() {
  const values=new Map();
  return {get length(){return values.size;},key:index=>[...values.keys()][index]??null,getItem:key=>values.get(key)??null,
    setItem(key,value){values.set(key,String(value));},removeItem:key=>values.delete(key)};
}
export function receiptLocks() {
  const active=new Set();
  return {async request(key,options,callback){
    if(active.has(key))return callback(null);
    active.add(key);try{return await callback({name:key});}finally{active.delete(key);}
  }};
}
export function receivingDb(overrides={}) {
  const {db,sb}=supportDb(overrides);
  Object.assign(db,{receipts:new Map(),requests:[],networkError:false,lostResponse:false,capabilityError:null,wrongReply:false,failCreate:false,tail:Promise.resolve()});
  function api(userId='user1') {
    return {
      async capabilities(){if(db.capabilityError)throw db.capabilityError;return {version:1,atomic:true,idempotent:true};},
      async activate(code){
        if(db.networkError)throw Error('network offline');
        const other=code.replace(/^ZAP-/,'');
        let row=db.marbetes.find(row=>row.codigo===code||row.codigo===other);
        if(!row){row={codigo:code,departamento_id:'dept1',activo:true,zona:'BODEGA'};db.marbetes.push(row);}
        if(row.departamento_id!=='dept1'||!row.activo)throw Object.assign(Error('Marbete ajeno o inactivo'),{code:'22023'});
        return structuredClone(row);
      },
      lookup:codes=>{if(db.networkError)throw Error('network offline');return lookupSupportCodes(sb,codes,'dept1');},
      async ensureProduct(code) {
        if(db.networkError||db.failCreate)throw Error('SKU '+code+' pendiente de alta en catálogo.');
        let product=db.products.find(row=>row.sku===code&&row.departamento_id==='dept1');
        if(!product){
          product={id:'provisional-'+code,sku:code,upc:null,descripcion:'SIN DESCRIPCIÓN · '+code,
            marca:null,talla:null,color:null,precio:0,stock:0,activo:true,departamento_id:'dept1'};
          db.products.push(product);
        }
        return structuredClone(product);
      },
      legacyReceive(payload){return this.receive(payload);},
      async receive(payload){
        const transaction=db.tail.then(async()=>{
          db.requests.push(structuredClone(payload));
          if(db.networkError)throw Error('network offline');
          if(db.receipts.has(payload.p_id)){
            const previous=db.receipts.get(payload.p_id);
            if(previous.request!==JSON.stringify(payload))throw Object.assign(Error('ID conflict'),{code:'22023'});
            return structuredClone(previous.receipt);
          }
          const p=db.products.find(row=>row.id===payload.p_producto);
          if(!p?.activo||p.departamento_id!==payload.p_departamento)throw Object.assign(Error('Producto no disponible'),{code:'22023'});
          let loc=payload.p_marbete ? db.assignments.find(row=>row.sku===p.sku&&row.marbete_codigo===payload.p_marbete) : null;
          if(payload.p_marbete&&!loc){loc={sku:p.sku,marbete_codigo:payload.p_marbete,cantidad:0};db.assignments.push(loc);}
          if(payload.p_reversa){
            const original=db.receipts.get(payload.p_reversa);
            if(!original||original.receipt.user_id!==userId||original.receipt.session_id!==payload.p_sesion||[...db.receipts.values()].some(row=>row.receipt.reverses===payload.p_reversa))throw Object.assign(Error('Compensación inválida'),{code:'22023'});
          }
          const delta=payload.p_reversa?-1:1;
          if(p.stock+delta<0||(loc&&(loc.cantidad||0)+delta<0))throw Object.assign(Error('Stock insuficiente'),{code:'22023'});
          p.stock+=delta;if(loc)loc.cantidad=(loc.cantidad||0)+delta;
          const receipt={id:payload.p_id,session_id:payload.p_sesion,user_id:userId,product_id:p.id,sku:p.sku,
            marbete_codigo:payload.p_marbete,quantity:1,kind:delta===1?'receive':'undo',reverses:payload.p_reversa,
            stock_resultante:p.stock,location_quantity:loc?.cantidad??null,stored_at:new Date().toISOString()};
          db.movements.push({...structuredClone(receipt),cantidad:1,tipo:delta===1?'ENTRADA':'SALIDA'});
          db.receipts.set(payload.p_id,{request:JSON.stringify(payload),receipt:structuredClone(receipt)});
          if(db.lostResponse){db.lostResponse=false;throw Error('Response lost after commit');}
          return db.wrongReply?{}:receipt;
        });
        db.tail=transaction.catch(()=>{});
        return transaction;
      }
    };
  }
  return {db,api};
}
