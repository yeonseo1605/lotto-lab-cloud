export type Draw={drawNo:number;numbers:number[];bonus:number};
export const VERSION='coverage-2.1.0';
function hashSeed(s:string){let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
function rng(seed:string){let a=hashSeed(seed);return()=>{a|=0;a=a+0x6D2B79F5|0;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
function partition(nums:number[],random:()=>number){const out=Array.from({length:5},()=>[] as number[]),sorted=[...nums].sort((a,b)=>a-b);for(let band=0;band<6;band++){const order=[0,1,2,3,4];for(let i=4;i;i--){const j=Math.floor(random()*(i+1));[order[i],order[j]]=[order[j],order[i]]}sorted.slice(band*5,band*5+5).forEach((n,i)=>out[order[i]].push(n))}return out.map(x=>x.sort((a,b)=>a-b))}
export function portfolio(_history:Draw[],seed:string,_predictive=false){const random=rng(seed),pool=Array.from({length:45},(_,i)=>i+1);for(let i=44;i;i--){const j=Math.floor(random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]]}return partition(pool.slice(0,30),random)}
export const match=(a:number[],b:number[])=>a.filter(n=>b.includes(n)).length;
export function prize(ticket:number[],draw:Draw){const n=match(ticket,draw.numbers);if(n===6)return 1;if(n===5&&ticket.includes(draw.bonus))return 2;if(n===5)return 3;if(n===4)return 4;if(n===3)return 5;return null}
