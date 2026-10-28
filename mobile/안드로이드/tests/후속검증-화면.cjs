// 첫 상태 조회보다 빠른 서비스 종료와 사본 안내 경계를 실제 화면에서 검사한다.
module.exports=async({viewport,load,key,click,evaluate,until,wait,shot,check})=>{
  for(const width of [360,390,412]){
    await viewport(width);await load();await key();await click('#open-settings');await click('[data-pick-folder=summary]');await wait(60);await click('#close-settings');
    await evaluate("__mock.copyReport={failed:[{kind:'transcript',message:'폴더 없음.'},{kind:'summaryMd',message:'권한 없음.'},{kind:'summaryTxt',message:'폴더 없음'},{kind:'transcript',message:'폴더 없음.'},{kind:'audio',message:'권한 없음'}],written:[],skipped:[]}");
    await click('#history button');await wait(60);
    check(width+'px 다시 정리 버튼은 정리 단어를 한 글자씩 나누지 않음',await evaluate("(()=>{const t=document.getElementById('refine').firstChild,n=t.length;const a=document.createRange(),b=document.createRange();a.setStart(t,n-2);a.setEnd(t,n-1);b.setStart(t,n-1);b.setEnd(t,n);return a.getBoundingClientRect().top===b.getBoundingClientRect().top})()"));
    const reasons='전사문·요약본(.txt) — 폴더 없음, 요약본(.md)·원음 — 권한 없음. 설정에서 폴더를 확인한 뒤 ‘고른 폴더에 다시 저장’을 누르세요.';
    check(width+'px N2 열기 실패는 확인 문구와 이유별 묶음',await evaluate("document.getElementById('copies-state').textContent==="+JSON.stringify('고른 폴더의 사본을 확인하지 못했습니다: '+reasons)));
    await evaluate("document.getElementById('copies-panel').scrollIntoView()");await shot('후속-'+width+'-사본확인실패.png');
    await evaluate('__mock.copiesResult=__mock.copyReport');await click('#save-copies');await wait(60);
    check(width+'px N2 저장 실패는 같은 이유를 한 번씩',await evaluate("document.getElementById('copies-state').textContent==="+JSON.stringify('고른 폴더에 저장하지 못했습니다: '+reasons)));
    await shot('후속-'+width+'-사본저장실패.png');await click('#close-result');
    await load();await key();await click('#history button');await wait(60);
    await evaluate("document.getElementById('result-version').value='1233';document.getElementById('result-version').dispatchEvent(new Event('change'))");await wait(60);
    const text='  앞선 결과 의견을 보존합니다.\n  ';
    for(const mode of ['failure','failure','late','success']){
      await evaluate("__mock.refineOutcome="+JSON.stringify(mode)+";document.getElementById('review-comment').value="+JSON.stringify(text)+";document.getElementById('review-comment').dispatchEvent(new Event('input'))");
      const before=await evaluate("__mock.calls.filter(c=>c.method==='refine').length");await click('#refine');
      if(mode==='late'){
        await until("__mock.active&&document.getElementById('review-comment').disabled");
        await evaluate("__mock.active=false;__mock.meeting={...__mock.meeting,state:'failed',resultId:'1234',message:'늦은 실패'}");
      }
      if(mode==='success'){
        check(width+'px N1 1.5초 이내 성공도 새 결과 열기',await until("document.getElementById('result-version').value==='1235'&&document.getElementById('review-comment').value===''&&!document.getElementById('review-comment').disabled"));
      }else{
        check(width+'px N1 '+mode+' 시도 '+before+'는 앞선 결과·의견·실패 안내 유지',await until("document.getElementById('result-version').value==='1233'&&document.getElementById('review-comment').value==="+JSON.stringify(text.trim())+"&&document.getElementById('review-state').textContent==='다시 정리하지 못했습니다. 평가는 저장되어 있고 앞선 결과는 그대로입니다.'"));
        check(width+'px 평가 저장 요청은 앞뒤 공백 제거',await evaluate("__mock.calls.filter(c=>c.method==='review').at(-1).data.comment==="+JSON.stringify(text.trim())));
      }
      check(width+'px N1 시도 표지는 매번 새 값',await evaluate("(()=>{const ids=__mock.calls.filter(c=>c.method==='refine').map(c=>c.data.attemptId);return ids.every(x=>typeof x==='string'&&x.length>0)&&new Set(ids).size===ids.length})()"));
      await evaluate("document.getElementById('review-panel').scrollIntoView()");await shot('후속-'+width+'-'+mode+'-'+before+'.png');
    }
    await evaluate("__mock.meeting={...__mock.meeting,state:'analyzing'};__mock.active=true");await wait(1650);
    await evaluate("__mock.active=false;__mock.meeting={...__mock.meeting,state:'failed'}");await wait(1700);
    check(width+'px N1 처리한 다시 정리 표지는 다른 실패에 재사용 안 함',await evaluate("document.getElementById('review-state').textContent!== '다시 정리하지 못했습니다. 평가는 저장되어 있고 앞선 결과는 그대로입니다.'"));
    check(width+'px 후속 결과 가로 넘침 없음',await evaluate('document.documentElement.scrollWidth<=innerWidth'));
    await click('#close-result');
  }
};
