export function locationDb(overrides={}) {
  const db={
    products:[{id:'p1',sku:'0012345678',upc:'2000000000001',descripcion:'TENIS JOMA',stock:2,activo:true,departamento_id:'dept1'}],
    marbetes:[{codigo:'459-001',zona:'BODEGA',descripcion:'Cajón 1',activo:true,departamento_id:'dept1'}],
    assignments:[],calls:[],writeError:null,commitWithError:false,readError:null,
    ...structuredClone(overrides)
  };
  class Query {
    constructor(table){this.table=table;this.action='select';this.filters=[];this.options={}}
    select(columns){this.columns=columns;return this}
    eq(key,value){this.filters.push(row=>row[key]===value);return this}
    in(key,values){this.filters.push(row=>values.includes(row[key]));return this}
    gt(key,value){this.filters.push(row=>row[key]>value);return this}
    limit(n){this.maximum=n;return this}
    maybeSingle(){this.one=true;return this}
    upsert(payload,options){this.action='upsert';this.payload=payload;this.options=options;return this}
    insert(payload){this.action='insert';this.payload=payload;return this}
    abortSignal(signal){this.signal=signal;return this}
    then(resolve,reject){return Promise.resolve().then(()=>this.execute()).then(resolve,reject)}
    execute(){
      db.calls.push({table:this.table,action:this.action,payload:this.payload,options:this.options});
      if(this.signal?.aborted)return {data:null,error:{message:'aborted'}};
      const table={productos:db.products,marbetes:db.marbetes,producto_marbetes:db.assignments}[this.table];
      if(!table)throw Error('Unexpected table '+this.table);
      if(this.action==='select'){
        if(db.readError && (!db.readError.table || db.readError.table===this.table) && (!db.readError.afterWrite || db.calls.some(x=>x.action!=='select'))) return {data:null,error:db.readError};
        let rows=table.filter(row=>this.filters.every(f=>f(row))).slice(0,this.maximum);
        if(this.columns?.includes('marbetes('))rows=rows.map(row=>({...row,marbetes:db.marbetes.find(m=>m.codigo===row.marbete_codigo)}));
        return {data:structuredClone(this.one?(rows[0]||null):rows),error:null};
      }
      if(db.writeError && !db.commitWithError)return {data:null,error:db.writeError};
      if(this.table==='producto_marbetes'){
        const prior=table.find(x=>x.sku===this.payload.sku && x.marbete_codigo===this.payload.marbete_codigo);
        if(!prior)table.push(structuredClone(this.payload));
        else if(!this.options.ignoreDuplicates)Object.assign(prior,this.payload);
      }else if(this.table==='marbetes'){
        if(table.some(x=>x.codigo===this.payload.codigo))return {data:null,error:{code:'23505',message:'Duplicate label'}};
        table.push(structuredClone(this.payload));
      }else throw Error('Unexpected mutation of '+this.table);
      return {data:null,error:db.writeError};
    }
  }
  return {db,sb:{from:table=>new Query(table)}};
}
