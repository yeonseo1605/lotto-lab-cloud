import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {corsHeaders,json} from '../_shared/cors.ts';
import {evaluate,portfolio,VERSION} from '../_shared/lotto.ts';

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  try{
    const body=await req.json().catch(()=>({}));
    const auth=req.headers.get('Authorization')||'',url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const client=createClient(url,anon,{global:{headers:{Authorization:auth}}}),admin=createClient(url,service);
    const {data:{user}}=await client.auth.getUser();
    if(!user)return json({error:'로그인이 필요합니다.'},401);
    const drawRows:any[]=[];
    for(let from=0;;from+=1000){const {data:page,error}=await admin.from('lotto_draws').select('draw_no,numbers,bonus').order('draw_no').range(from,from+999);if(error)throw error;drawRows.push(...(page||[]));if(!page||page.length<1000)break}
    if(!drawRows.length)return json({error:'당첨 회차 데이터를 먼저 동기화하세요.'},409);
    const draws=drawRows.map(d=>({drawNo:d.draw_no,numbers:d.numbers,bonus:d.bonus})),historyEnd=draws.at(-1)!.drawNo,targetDraw=historyEnd+1;
    const {data:setting}=await admin.from('user_settings').select('max_generation_attempts').eq('user_id',user.id).maybeSingle(),max=setting?.max_generation_attempts||3;
    const {data:existing,error:existingError}=await admin.from('prediction_batches').select('id,attempt_no').eq('user_id',user.id).eq('target_draw',targetDraw);
    if(existingError)throw existingError;
    const count=existing?.length||0;
    if(body.stateOnly){
      const {data:preview,error}=await admin.from('prediction_batches').select('id,attempt_no,strategy_used,reason,prediction_tickets(ticket_no,numbers)').eq('user_id',user.id).eq('target_draw',targetDraw).eq('status','preview').order('created_at',{ascending:false}).limit(1).maybeSingle();
      if(error)throw error;
      return json({targetDraw,attempts:count||0,maxAttempts:max,preview:preview?{batchId:preview.id,attemptNo:preview.attempt_no,strategyUsed:preview.strategy_used,reason:preview.reason,tickets:[...preview.prediction_tickets].sort((a:any,b:any)=>a.ticket_no-b.ticket_no).map((x:any)=>x.numbers)}:null});
    }
    if(body.action!=='generate')return json({error:'생성 버튼을 통한 명시적 요청만 허용됩니다.'},400);
    const attempt=(count||0)+1;
    if(attempt>max)return json({error:`이번 회차는 최대 ${max}회까지 생성할 수 있습니다.`},409);
    let {data:ev}=await admin.from('strategy_evaluations').select('*').eq('history_end',historyEnd).maybeSingle();
    if(!ev){const e=evaluate(draws),row={history_end:historyEnd,evaluated:e.evaluated,random_average:e.randomAverage,predictive_average:e.predictiveAverage,mean_difference:e.meanDifference,ci_low:e.ciLow,ci_high:e.ciHigh,p_value:e.pValue,recommended:e.recommended,reason:e.reason,model_version:VERSION};const saved=await admin.from('strategy_evaluations').upsert(row).select().single();if(saved.error)throw saved.error;ev=saved.data}
    const seed=crypto.randomUUID(),predictive=ev.recommended==='predictiveCoverage',tickets=portfolio(draws,seed,predictive),encoded=new TextEncoder().encode(JSON.stringify({targetDraw,tickets,seed,version:VERSION})),contentHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoded))).map(x=>x.toString(16).padStart(2,'0')).join('');
    const inserted=await admin.from('prediction_batches').insert({user_id:user.id,target_draw:targetDraw,strategy_used:ev.recommended,reason:ev.reason,seed,model_version:VERSION,history_end:historyEnd,attempt_no:attempt,max_attempts:max,content_hash:contentHash}).select().single();
    if(inserted.error)throw inserted.error;
    const ti=await admin.from('prediction_tickets').insert(tickets.map((numbers,i)=>({batch_id:inserted.data.id,ticket_no:i+1,numbers})));
    if(ti.error)throw ti.error;
    return json({batchId:inserted.data.id,targetDraw,tickets,strategy:ev.recommended,strategyLabel:predictive?'검증 통과 예측 커버리지':'안전 무작위 커버리지',reason:ev.reason,attemptNo:attempt,maxAttempts:max,hash:contentHash});
  }catch(e){return json({error:e instanceof Error?e.message:String(e)},500)}
});
