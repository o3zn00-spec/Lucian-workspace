export const getBybitConfig=async()=>({configured:true,environment:'mainnet',apiKey:globalThis.autoFixture.key,apiSecret:'fixture'});
export async function bybitPublicRequest(_e,path,q){const f=globalThis.autoFixture;if(path.includes('risk-limit'))return {list:[{symbol:q.symbol,riskLimitValue:'1000000',maintenanceMargin:0.005,initialMargin:0.01,maxLeverage:'100'}]};return {list:[path.includes('instruments-info')?{symbol:q.symbol,status:'Trading',quoteCoin:'USDT',settleCoin:'USDT',contractType:'LinearPerpetual',lotSizeFilter:{qtyStep:'0.00001',minOrderQty:f.minQty??'0.00001',minNotionalValue:'1',maxMktOrderQty:'10'},priceFilter:{tickSize:'0.01'}}:{symbol:q.symbol,ask1Price:String(f.last),bid1Price:String(f.last-0.1),lastPrice:String(f.last),markPrice:String(f.mark??f.last)}]};}
function fill(f,o,quantity,price){
  const fee=quantity*price*.001,qty=String(quantity),cashFlow=o.side==='Buy'?quantity*(100-price):0;
  f.position=Number((f.position+(o.side==='Sell'?quantity:-quantity)).toFixed(8));
  if(f.position<0)throw Error('Fixture detects position flip');
  o.cumExecQty=qty;o.leavesQty='0';o.updatedTime=String(Date.now());o.orderStatus=quantity<Number(o.qty)?'PartiallyFilledCanceled':'Filled';
  const id='fill-'+o.orderId,execTime=String(Date.now());
  f.fills.set(o.orderId,[{...o,execId:id,execType:'Trade',execQty:qty,execPrice:String(price),execFee:fee.toFixed(8),feeCurrency:'USDT',execTime}]);
  f.ledger.push({id:'log-'+id,tradeId:id,orderId:o.orderId,symbol:o.symbol,category:'linear',currency:'USDT',transactionTime:execTime,type:'TRADE',side:o.side,qty,tradePrice:String(price),fee:fee.toFixed(8),funding:'0',cashFlow:cashFlow.toFixed(8),change:(cashFlow-fee).toFixed(8),transSubType:''});
}
export async function bybitRequest(_u,path,options={}){
  const f=globalThis.autoFixture,q=options.query??{};
  if(options.method==='POST'){
    f.writes.push({path,body:options.body});
    if(path.includes('cancel')){const o=[...f.orders.values()].find(o=>o.orderId===options.body.orderId);if(f.cancelRace)fill(f,o,Number(o.qty),110);else{o.orderStatus='Cancelled';o.leavesQty='0';o.updatedTime=String(Date.now());}return {orderId:o.orderId};}
    if(path!=='/v5/order/create')throw Error('Forbidden setting mutation');
    const b=options.body,id='order-'+f.writes.length,conditional=!!b.triggerPrice;
    if(b.side==='Buy'&&b.reduceOnly!==true)throw Error('Unprotected cover');
    const o={...b,orderId:id,orderLinkId:b.orderLinkId,symbol:b.symbol,side:b.side,qty:String(b.qty),cumExecQty:'0',leavesQty:String(b.qty),orderStatus:'Untriggered',updatedTime:String(Date.now()),triggerPrice:b.triggerPrice??''};f.orders.set(b.orderLinkId,o);
    if(!conditional){const qty=Number(b.qty)*(b.side==='Sell'?f.partialEntry??1:f.partialExit??1);fill(f,o,qty,f.last);if(b.side==='Buy')f.partialExit=1;}
    if(f.failSubmit){f.failSubmit=false;throw Error('lost acknowledgement');}return {orderId:id};
  }
  if(path==='/v5/account/info')return {marginMode:f.marginMode??'ISOLATED_MARGIN'};
  if(path==='/v5/position/list'){const list=[{symbol:q.symbol,positionIdx:f.positionIdx??0,side:f.position?'Sell':'',size:String(f.position),positionStatus:'Normal',leverage:f.leverage??'1',autoAddMargin:f.autoAddMargin??0,avgPrice:f.position?'100':'0',liqPrice:f.liq??'190'}];if(f.positionIdx===2)list.unshift({...list[0],positionIdx:1,side:'',size:'0'});return {list};}
  if(path.includes('wallet-balance'))return {list:[{accountType:'UNIFIED',totalAvailableBalance:f.crossAvailable??'1000',accountIMRate:'0.01',accountMMRate:'0.005',coin:[{coin:'USDT',walletBalance:'1000',equity:'1000',usdValue:'1000',locked:'0',spotBorrow:'0',bonus:'0',totalPositionIM:String(f.position*100),totalOrderIM:'0'}]}]};
  if(path.includes('fee-rate'))return {list:[{symbol:q.symbol,takerFeeRate:'0.001'}]};
  if(path.includes('transaction-log'))return {list:f.ledgerFail?[]:f.ledger.filter(r=>Number(r.transactionTime)>=q.startTime&&Number(r.transactionTime)<=q.endTime),nextPageCursor:''};
  if(path.includes('execution/list'))return {category:'linear',list:q.orderId?(f.fills.get(q.orderId)??[]):[...f.fills.values()].flat().filter(e=>Number(e.execTime)>=q.startTime&&Number(e.execTime)<=q.endTime),nextPageCursor:''};
  if(path.includes('order/'))return {category:'linear',list:q.orderLinkId?(f.orders.has(q.orderLinkId)?[f.orders.get(q.orderLinkId)]:[]):[...f.orders.values()].filter(o=>['New','Untriggered','PartiallyFilled'].includes(o.orderStatus)),nextPageCursor:''};
  throw Error('Unmocked exchange endpoint '+path);
}
