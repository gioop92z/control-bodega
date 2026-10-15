export function supportDb(overrides = {}) {
  const db = {
    products:[{id:'p1',sku:'0012345678',upc:'0200000000001',descripcion:'TENIS UNO',stock:10,activo:true,departamento_id:'dept1'}, {id:'p2',sku:'0012345679',upc:'0200000000002',descripcion:'TENIS DOS',stock:10,activo:true,departamento_id:'dept1'}],
    marbetes:[{codigo:'ZAP-459-001',zona:'BODEGA',descripcion:'Cajón 1',activo:true,departamento_id:'dept1'}, {codigo:'ZAP-459-002',zona:'BODEGA',descripcion:'Cajón 2',activo:true,departamento_id:'dept1'}],
    assignments:[], movements:[], calls:[], rpcCalls:[], readError:null, rpcError:null, commitWithError:false, ...structuredClone(overrides)
  };
  class Query {
    constructor(table) { this.table=table; this.filters=[]; this.orders=[]; this.offset=0; this.maximum=Infinity; this.action='select'; }
    select(columns) { this.columns=columns; return this; }
    eq(key,value) { this.filters.push(row=>row[key]===value); return this; }
    in(key,values) { this.filters.push(row=>values.includes(row[key])); return this; }
    order(key) { this.orders.push(key); return this; }
    gt(key,value) { this.filters.push(row=>row[key]>value); return this; }
    limit(value) { this.maximum=value; return this; }
    range(from,to) { this.offset=from; this.maximum=to-from+1; return this; }
    maybeSingle() { this.one=true; return this; }
    abortSignal(signal) { this.signal=signal; return this; }
    upsert(payload, options) { this.action='upsert'; this.payload=payload; this.options=options; return this; }
    insert(payload) { this.action='insert'; this.payload=payload; return this; }
    then(resolve,reject) { return Promise.resolve().then(()=>db.queryDelay?new Promise(done=>setTimeout(done,db.queryDelay)):null).then(()=>this.execute()).then(resolve,reject); }
    execute() {
      db.calls.push({table:this.table, action:this.action, payload:this.payload, columns:this.columns, offset:this.offset});
      const data={productos:db.products,marbetes:db.marbetes,producto_marbetes:db.assignments,movimientos:db.movements}[this.table];
      if (!data) throw Error('Unexpected table '+this.table);
      if (this.action==='select') {
        if (db.readError && (!db.readError.table || db.readError.table===this.table)) return {data:null,error:db.readError};
        let rows=data.filter(row=>this.filters.every(filter=>filter(row)));
        rows.sort((a,b)=>{for(const field of this.orders){const comparison=String(a[field]).localeCompare(String(b[field]));if(comparison)return comparison;}return 0;});
        rows=rows.slice(this.offset,this.offset+this.maximum);
        if (this.columns?.includes('marbetes(')) rows=rows.map(row=>({...row,marbetes:db.marbetes.find(m=>m.codigo===row.marbete_codigo)}));
        return {data:structuredClone(this.one ? rows[0]||null : rows), error:null};
      }
      if (this.table==='producto_marbetes') {
        for(const item of (Array.isArray(this.payload)?this.payload:[this.payload])) {
          const prior=data.find(row=>row.sku===item.sku && row.marbete_codigo===item.marbete_codigo);
          if(!prior)data.push(structuredClone(item));
          else if(!this.options?.ignoreDuplicates)Object.assign(prior,item);
        }
      } else if (this.table==='marbetes') {
        if(data.some(row=>row.codigo===this.payload.codigo))return {data:null,error:{code:'23505',message:'Duplicate label'}};
        data.push(structuredClone(this.payload));
      } else throw Error('Unexpected write '+this.table);
      return {data:null,error:null};
    }
  }
  return {db,sb:{from:table=>new Query(table),rpc(name,payload) {
    if(name!=='mover_stock_v2')throw Error('Unexpected RPC '+name);
    return {abortSignal(){return this;}, then(resolve,reject){
      return Promise.resolve().then(()=>{
        db.rpcCalls.push(structuredClone(payload));
        if (db.rpcError && !db.commitWithError) return {data:null,error:db.rpcError};
        const product=db.products.find(row=>row.id===payload.p_producto);
        if (!product || product.stock<payload.p_cantidad) return {data:null,error:{code:'P0001',message:'Stock insuficiente'}};
        // This intentionally does not deduplicate p_id: the client must never
        // send a movement twice, including after losing a committed response.
        product.stock-=payload.p_cantidad;
        if(payload.p_marbete){const loc=db.assignments.find(row=>row.sku===product.sku && row.marbete_codigo===payload.p_marbete);if(loc)loc.cantidad-=payload.p_cantidad;}
        db.movements.push({id:payload.p_id,tipo:'SALIDA',sku:product.sku,cantidad:payload.p_cantidad,departamento_id:product.departamento_id,marbete_codigo:payload.p_marbete});
        return {data:{stock_resultante:product.stock},error:db.rpcError};
      }).then(resolve,reject);
    }};
  }}};
}

export function memoryStorage() {
  const values=new Map(); return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
}
export function testLocks() {
  const active=new Set();return {async request(key, options, action){if(active.has(key))return action(null);active.add(key);try{return await action({name:key});}finally{active.delete(key);}}};
}
