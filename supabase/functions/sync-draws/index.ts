import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {json} from '../_shared/cors.ts';
import {match,portfolio,prize,VERSION} from '../_shared/lotto.ts';

const RESULT_URL='https://www.dhlottery.co.kr/lt645/result';
const API_URL='https://www.dhlottery.co.kr/lt645/selectPstLt645InfoNew.do?srchDir=center&srchLtEpsd=';

async function fetchRows(no:number){
  const r=await fetch(API_URL+no,{headers:{referer:RESULT_URL}});
  if(!r.ok)throw new Error(`동행복권 API ${r.status} (${no}회)`);
  const x=await r.json(),list=Array.isArray(x)?x:(x.data?.list||x.data||[]);
  return Array.isArray(list)?list:[];
}

Deno.serve(async req=>{
  try{
    if(req.headers.get('x-cron-secret')!==Deno.env.get('CRON_SECRET'))return json({error:'unauthorized'},401);
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const page=await fetch(RESULT_URL).then(r=>{if(!r.ok)throw new Error(`동행복권 결과 페이지 ${r.status}`);return r.text()});
    const latest=+(page.match(/data-value="(\d+)"/)?.[1]||0);
    if(!latest)throw new Error('최신 확정 회차를 확인하지 못했습니다.');
    const {data:last,error:lastError}=await admin.from('lotto_draws').select('draw_no').order('draw_no',{ascending:false}).limit(1).maybeSingle();
    if(lastError)throw lastError;
    const previousLatest=last?.draw_no||0,start=previousLatest+1;
    let added=0;
    if(start<=latest){
      const requests:number[]=[];
      // 응답은 요청 회차를 중심으로 최대 10개(대체로 -5..+4)를 돌려준다.
      for(let no=Math.min(start+4,latest);no<=latest;no+=10)requests.push(no);
      if(requests.at(-1)!==latest)requests.push(latest);
      for(let i=0;i<requests.length;i+=8){
        const groups=await Promise.all(requests.slice(i,i+8).map(fetchRows)),rows=new Map<number,any>();
        for(const d of groups.flat())if(+d.ltEpsd>=start&&+d.ltEpsd<=latest)rows.set(+d.ltEpsd,d);
        const values=[...rows.values()].map(d=>{const raw=String(d.ltRflYmd).replace(/\D/g,''),numbers=[1,2,3,4,5,6].map(n=>+d[`tm${n}WnNo`]);if(raw.length!==8||numbers.some(n=>n<1||n>45)||!d.bnsWnNo)return null;return {draw_no:+d.ltEpsd,draw_date:`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`,numbers,bonus:+d.bnsWnNo}}).filter(Boolean);
        if(values.length){const saved=await admin.from('lotto_draws').upsert(values);if(saved.error)throw saved.error;added+=values.length}
      }
    }
    const drawRows:any[]=[];
    for(let from=0;;from+=1000){const q=await admin.from('lotto_draws').select('draw_no,numbers,bonus').order('draw_no').range(from,from+999);if(q.error)throw q.error;drawRows.push(...(q.data||[]));if(!q.data||q.data.length<1000)break}
    const draws=drawRows.map(d=>({drawNo:d.draw_no,numbers:d.numbers,bonus:d.bonus})),historyEnd=draws.at(-1)?.drawNo||0;
    if(historyEnd<latest)throw new Error(`회차 동기화 미완료: ${historyEnd}/${latest}`);
    const {data:batches,error:batchError}=await admin.from('prediction_batches').select('id,target_draw,prediction_tickets(id,numbers)').in('status',['locked','purchased']).lte('target_draw',latest);
    if(batchError)throw batchError;
    let scored=0;
    for(const b of batches||[]){const d=draws.find(x=>x.drawNo===b.target_draw);if(!d)continue;const scores=b.prediction_tickets.map((t:any)=>({id:t.id,matches:match(t.numbers,d.numbers),prize:prize(t.numbers,d)}));for(const s of scores){const q=await admin.from('prediction_tickets').update({matches:s.matches,prize:s.prize}).eq('id',s.id);if(q.error)throw q.error}const wins=scores.map((s:any)=>s.prize).filter(Boolean),q=await admin.from('prediction_batches').update({status:'scored',scored_at:new Date().toISOString(),best_matches:Math.max(...scores.map((s:any)=>s.matches)),best_prize:wins.length?Math.min(...wins):null}).eq('id',b.id);if(q.error)throw q.error;scored++}
    let generated=0;
    // 매 재시도에서 빠진 사용자만 보충하므로 중간 실패 뒤에도 자동 생성이 복구된다.
    if(draws.length){
      const targetDraw=historyEnd+1,reason='30개 숫자 무중복 분산 · 생일수·연속수·반복 패턴 회피';
      for(let pageNo=1;;pageNo++){const users=await admin.auth.admin.listUsers({page:pageNo,perPage:1000});if(users.error)throw users.error;for(const user of users.data.users){const exists=await admin.from('prediction_batches').select('id').eq('user_id',user.id).eq('target_draw',targetDraw).limit(1).maybeSingle();if(exists.error)throw exists.error;if(exists.data)continue;const setting=await admin.from('user_settings').select('max_generation_attempts').eq('user_id',user.id).maybeSingle();const seed=crypto.randomUUID(),tickets=portfolio(draws,seed),encoded=new TextEncoder().encode(JSON.stringify({targetDraw,tickets,seed,version:VERSION})),contentHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoded))).map(x=>x.toString(16).padStart(2,'0')).join('');const batch=await admin.from('prediction_batches').insert({user_id:user.id,target_draw:targetDraw,strategy_used:'randomCoverage',reason,seed,model_version:VERSION,history_end:historyEnd,attempt_no:1,max_attempts:setting.data?.max_generation_attempts||3,content_hash:contentHash}).select().single();if(batch.error)throw batch.error;const ti=await admin.from('prediction_tickets').insert(tickets.map((numbers,i)=>({batch_id:batch.data.id,ticket_no:i+1,numbers})));if(ti.error)throw ti.error;generated++}if(users.data.users.length<1000)break}
    }
    return json({ok:true,latest,previousLatest,added,scored,generated,targetDraw:historyEnd+1});
  }catch(e){return json({error:e instanceof Error?e.message:String(e)},500)}
});
