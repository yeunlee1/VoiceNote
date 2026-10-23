// 공용 기본 키 3회 체험의 차감·예약·해제·재시작 보존 규칙을 안드로이드 없이 데스크톱과 같은 기준으로 검증한다.
package kr.local.meetingjournal;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
public final class TrialAccessTest {
    static int checks;
    static void expect(boolean value,String label){if(!value)throw new AssertionError(label);checks++;}
    static String id(){return UUID.randomUUID().toString();}
    static TrialAccess.Gate begin(TrialAccess trial,String id){return trial.begin(id,false,true);}
    static TrialAccess.Status trialStatus(TrialAccess trial){return trial.status(false,true);}
    static String succeed(TrialAccess trial) throws Exception {
        String value=id();
        expect(begin(trial,value).allowed,"예약 허용");
        expect(trial.markSucceeded(value),"성공 표시");
        expect(trial.finish(value).counted,"확정");
        return value;
    }
    static void delete(File file){File[] children=file.listFiles();if(children!=null)for(File child:children)delete(child);file.delete();}

    public static void main(String[] args) throws Exception {
        File root=Files.createTempDirectory("trial-access-").toFile();
        try{run(root);}finally{delete(root);}
        System.out.println("TrialAccessTest 통과: "+checks+"개 확인");
    }

    static void run(File root) throws Exception {
        File file=new File(root,"a/trial-access.json");
        TrialAccess trial=new TrialAccess(file);
        expect(trialStatus(trial).accessMode.equals("trial")&&trialStatus(trial).trialRemaining==3&&!trialStatus(trial).mustRegister,"처음은 3회 체험");

        // 전사·분할·자동 재시도는 한 분석 ID 안에서 한 번만 센다.
        String shared=id();
        for(int i=0;i<8;i++)expect(begin(trial,shared).allowed&&"default".equals(begin(trial,shared).useKey),"같은 ID 반복 허용");
        expect(trialStatus(trial).trialReserved==1,"예약 1개");
        trial.markSucceeded(shared);trial.markSucceeded(shared);
        expect(trial.finish(shared).counted,"분석 1회 확정");
        expect(trialStatus(trial).trialUsed==1,"1회 차감");

        // 실패·취소는 차감하지 않는다.
        for(int i=0;i<5;i++){String value=id();expect(begin(trial,value).allowed&&trial.release(value),"실패 시 회수");}
        expect(!trial.release(id())&&trialStatus(trial).trialUsed==1&&trialStatus(trial).trialReserved==0,"실패는 미차감");

        // 성공 표시 없는 예약은 확정하지 않고 회수한다.
        String noCall=id();begin(trial,noCall);
        TrialAccess.Finish none=trial.finish(noCall);
        expect(!none.counted&&!none.alreadyFinished&&trialStatus(trial).trialReserved==0&&trialStatus(trial).trialUsed==1,"성공 요청 없는 예약 미차감");

        // 멱등 확정과 끝난 ID 재사용 차단
        expect(trial.finish(shared).alreadyFinished&&!trial.finish(shared).counted,"중복 finish 멱등");
        expect(trial.finish(shared.toUpperCase(Locale.ROOT)).alreadyFinished,"대소문자 무관");
        expect("TRIAL_ID_FINISHED".equals(begin(trial,shared).code),"끝난 ID 재사용 차단");
        expect("INVALID_ANALYSIS".equals(begin(trial,"bad").code)&&"INVALID_ANALYSIS".equals(begin(trial,null).code),"분석 ID 필수");

        // 동시 예약으로 3회 초과 차단
        String a=id(),b=id();
        expect(begin(trial,a).allowed&&begin(trial,b).allowed,"남은 2회 예약");
        TrialAccess.Gate inUse=begin(trial,id());
        expect(!inUse.allowed&&"TRIAL_IN_USE".equals(inUse.code)&&!inUse.mustRegister,"예약 초과 차단");
        trial.markSucceeded(a);trial.finish(a);

        // 재시작하면 횟수·완료 ID는 유지되고 미완료 예약은 회수된다.
        TrialAccess restarted=new TrialAccess(file);
        expect(trialStatus(restarted).trialUsed==2&&trialStatus(restarted).trialReserved==0,"재시작 후 보존과 예약 회수");
        expect(restarted.finish(a).alreadyFinished,"재시작 후에도 완료 ID 멱등");
        trial.markSucceeded(b);
        expect(!restarted.finish(b).counted,"이전 프로세스 예약은 확정 불가");
        succeed(restarted);

        // 4번째는 새 키 등록 요구
        TrialAccess.Gate fourth=begin(restarted,id());
        expect(!fourth.allowed&&"TRIAL_EXHAUSTED".equals(fourth.code)&&fourth.status==403&&fourth.mustRegister,"4번째 차단");
        expect("새로운 API키를 등록하세요.".equals(fourth.message)&&TrialAccess.EXHAUSTED_MESSAGE.equals(fourth.message),"정확한 문구");
        TrialAccess.Status exhausted=trialStatus(restarted);
        expect(exhausted.accessMode.equals("exhausted")&&exhausted.trialRemaining==0&&exhausted.mustRegister,"소진 상태");

        // 개인 키는 제한 없이 우선하고, 지워도 횟수는 그대로다.
        for(int i=0;i<5;i++){TrialAccess.Gate own=restarted.begin(id(),true,true);expect(own.allowed&&"personal".equals(own.useKey)&&!own.reserved,"개인 키 무제한");}
        expect(restarted.begin(null,true,true).allowed,"개인 키는 분석 ID 선택");
        expect(restarted.status(true,true).accessMode.equals("personal")&&!restarted.status(true,true).mustRegister,"개인 키 상태");
        expect(trialStatus(restarted).accessMode.equals("exhausted"),"개인 키 삭제 뒤에도 소진 유지");

        // 해제문자
        expect(!TrialAccess.isUnlockCode(" UNLOCK-TEST ")&&!TrialAccess.isUnlockCode("")&&!TrialAccess.isUnlockCode(null),"공개 소스에는 해제문자 없음");
        restarted.unlock();
        TrialAccess.Gate free=begin(restarted,id());
        expect(free.allowed&&"default".equals(free.useKey)&&"unlimited".equals(free.mode)&&!free.reserved,"해제 후 기본 키 무제한");
        expect("INVALID_ANALYSIS".equals(begin(restarted,"x").code),"해제 후에도 공용키는 분석 ID 필수");
        TrialAccess afterUnlock=new TrialAccess(file);
        expect(trialStatus(afterUnlock).accessMode.equals("unlimited")&&trialStatus(afterUnlock).trialUsed==3&&!trialStatus(afterUnlock).mustRegister,"해제 영구 보존");
        String saved=new String(Files.readAllBytes(file.toPath()),StandardCharsets.UTF_8);
        expect(saved.startsWith("{\"version\":1,\"used\":3,\"unlocked\":true,\"finished\":["),"해제 상태 저장 형식");

        // 키가 하나도 없으면 등록 요구
        TrialAccess.Status nothing=afterUnlock.status(false,false);
        expect(nothing.accessMode.equals("none")&&nothing.mustRegister&&"AI_KEY_MISSING".equals(afterUnlock.begin(id(),false,false).code),"키 없음");

        // 데스크톱이 저장한 형식도 읽는다.
        File desktop=new File(root,"desktop.json");
        String done=id();
        Files.write(desktop.toPath(),("{\"version\":1,\"used\":1,\"unlocked\":false,\"finished\":[\""+done+"\"]}").getBytes(StandardCharsets.UTF_8));
        TrialAccess shared2=new TrialAccess(desktop);
        expect(trialStatus(shared2).trialUsed==1&&shared2.finish(done).alreadyFinished,"데스크톱 형식 호환");

        // 손상 기록은 소진으로 처리하고 파일을 보존한다.
        File broken=new File(root,"broken.json");
        Files.write(broken.toPath(),"{\"version\":1,\"used\":\"0\"".getBytes(StandardCharsets.UTF_8));
        TrialAccess damaged=new TrialAccess(broken);
        expect(trialStatus(damaged).accessMode.equals("exhausted")&&!trialStatus(damaged).trialError.isEmpty(),"손상은 소진");
        expect(new String(Files.readAllBytes(broken.toPath()),StandardCharsets.UTF_8).equals("{\"version\":1,\"used\":\"0\""),"손상 파일 보존");
        expect(damaged.begin(id(),true,true).allowed,"손상 중에도 개인 키 허용");
        damaged.unlock();
        expect(trialStatus(new TrialAccess(broken)).accessMode.equals("unlimited"),"손상 뒤 해제 저장");

        // 방치 예약 기한
        final long[] clock={1000};
        TrialAccess leased=new TrialAccess(new File(root,"lease.json"),3,100,new TrialAccess.Clock(){public long now(){return clock[0];}});
        String old=id();begin(leased,old);leased.markSucceeded(old);clock[0]+=101;
        expect(trialStatus(leased).trialReserved==0&&!leased.finish(old).counted,"방치 예약 회수");

        // 저장 실패 시 확정·해제를 반영하지 않고, 복구 뒤 다시 finish하면 영속된다.
        File blocker=new File(root,"blocked");
        Files.write(blocker.toPath(),new byte[0]);
        File blockedFile=new File(blocker,"trial-access.json");
        TrialAccess failing=new TrialAccess(blockedFile);
        boolean thrown=false;
        try{failing.unlock();}catch(TrialAccess.StorageException e){thrown="TRIAL_STORAGE_FAILED".equals(e.code);}
        expect(thrown&&!trialStatus(failing).unlocked,"해제 저장 실패");
        String pending=id();begin(failing,pending);failing.markSucceeded(pending);
        thrown=false;
        try{failing.finish(pending);}catch(TrialAccess.StorageException e){thrown=true;}
        expect(thrown&&trialStatus(failing).trialUsed==0&&trialStatus(failing).trialReserved==1,"확정 저장 실패는 미반영");
        expect(blocker.delete(),"막힌 파일 제거");
        expect(failing.finish(pending).counted&&failing.finish(pending).alreadyFinished,"재시도 확정");
        expect(trialStatus(new TrialAccess(blockedFile)).trialUsed==1,"재시도 영속");
    }
}
