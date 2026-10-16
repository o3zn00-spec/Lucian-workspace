import React, {useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {CandleChart} from '../../src/components/markets/chart-workspace';
import {useMarketsStore,paneKey} from '../../src/store/markets';
const end=Math.floor(Date.now()/60000)*60;
const candles=Array.from({length:80},(_,i)=>({time:end-(80-i)*60,open:100+i/10,high:102+i/10,low:99+i/10,close:101+i/10,volume:1}));
function publish(){useMarketsStore.setState({candlesByKey:new Map([[paneKey('BTCUSD','M1'),candles.map(c=>({...c}))]])});}
function tick(){candles[candles.length-1].close+=0.01;publish()}
function Fixture(){const [symbol,setSymbol]=useState('BTCUSD');useEffect(()=>{Object.assign(window,{publishChart:publish,tickChart:tick,switchChart:()=>setSymbol('EURUSD')})},[]);return <div id="chart" style={{position:'relative',width:'100%',height:500}}><CandleChart symbol={symbol} timeframe="M1" status="live" bidPrice={108} askPrice={109} settings={{showAsk:true,showBid:true,showMarketOrders:true,showPendingOrders:true}} pendingOrderPrice={null} activeTool="cursor" drawings={[]} indicators={[]} onAddDrawing={()=>{}} onUpdateDrawing={()=>{}} onRetry={()=>{}}/></div>}
createRoot(document.getElementById('root')!).render(<Fixture/>);
