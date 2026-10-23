// 공용 기본 키의 설치별 3회 체험 횟수와 해제 상태를 데스크톱 체험권한.cjs와 같은 규칙으로 관리한다. 키 값은 다루지 않는다.
package kr.local.meetingjournal;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class TrialAccess {
    static final int TRIAL_LIMIT = 3;
    static final String EXHAUSTED_MESSAGE = "새로운 API키를 등록하세요.";
    static final long DEFAULT_LEASE_MS = 3L * 60 * 60 * 1000;
    private static final String UNLOCK_SHA256 = "";
    // 공개 소스에는 해제 코드를 두지 않는다. 빈 값이면 어떤 입력도 해제 코드로 보지 않는다.
    private static final int MAX_FINISHED = 50;
    private static final long MAX_STATE_BYTES = 64 * 1024;
    private static final Pattern ID = Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", Pattern.CASE_INSENSITIVE);
    private static final Pattern STATE = Pattern.compile("^\\s*\\{\\s*\"version\"\\s*:\\s*1\\s*,\\s*\"used\"\\s*:\\s*(\\d{1,9})\\s*,\\s*\"unlocked\"\\s*:\\s*(true|false)\\s*,\\s*\"finished\"\\s*:\\s*\\[(.*)\\]\\s*\\}\\s*$", Pattern.DOTALL);

    interface Clock { long now(); }

    static final class Status {
        public final String accessMode; public final int trialLimit, trialUsed, trialRemaining, trialReserved; public final boolean mustRegister, unlocked; public final String trialError;
        Status(String accessMode,int trialLimit,int trialUsed,int trialReserved,boolean unlocked,String trialError){
            this.accessMode=accessMode;this.trialLimit=trialLimit;this.trialUsed=trialUsed;this.trialRemaining=Math.max(0,trialLimit-trialUsed);this.trialReserved=trialReserved;
            this.mustRegister=accessMode.equals("exhausted")||accessMode.equals("none");this.unlocked=unlocked;this.trialError=trialError;
        }
    }

    static final class Gate {
        public final boolean allowed, reserved, mustRegister; public final String useKey, mode, code, message; public final int status;
        private Gate(boolean allowed,String useKey,String mode,boolean reserved,String code,int status,String message,boolean mustRegister){
            this.allowed=allowed;this.useKey=useKey;this.mode=mode;this.reserved=reserved;this.code=code;this.status=status;this.message=message;this.mustRegister=mustRegister;
        }
        static Gate allow(String useKey,String mode,boolean reserved){return new Gate(true,useKey,mode,reserved,null,200,null,false);}
        static Gate deny(String code,int status,String message,boolean mustRegister){return new Gate(false,null,null,false,code,status,message,mustRegister);}
    }

    static final class Finish {
        public final boolean counted, alreadyFinished;
        Finish(boolean counted,boolean alreadyFinished){this.counted=counted;this.alreadyFinished=alreadyFinished;}
    }

    static final class StorageException extends IOException {
        final String code="TRIAL_STORAGE_FAILED";
        StorageException(){super("체험 기록을 저장하지 못했습니다. 저장 공간을 확인해 주세요.");}
    }

    private static final class Reservation { long at; boolean succeeded; Reservation(long at){this.at=at;} }

    private final File stateFile;
    private final int limit;
    private final long leaseMs;
    private final Clock clock;
    private int used;
    private boolean unlocked;
    private List<String> finished=new ArrayList<>();
    private String trialError="";
    // 진행 중 예약은 메모리에만 둬 앱 프로세스가 다시 시작되면 회수된다.
    private final Map<String,Reservation> reservations=new LinkedHashMap<>();

    TrialAccess(File stateFile){this(stateFile,TRIAL_LIMIT,DEFAULT_LEASE_MS,new Clock(){public long now(){return System.currentTimeMillis();}});}

    TrialAccess(File stateFile,int limit,long leaseMs,Clock clock){
        this.stateFile=stateFile;this.limit=limit;this.leaseMs=leaseMs;this.clock=clock;
        if(stateFile==null||!stateFile.exists())return;
        try{
            if(!stateFile.isFile()||stateFile.length()>MAX_STATE_BYTES)throw new IOException("invalid_trial_file");
            Matcher m=STATE.matcher(new String(Files.readAllBytes(stateFile.toPath()),StandardCharsets.UTF_8));
            if(!m.matches())throw new IOException("invalid_trial_file");
            List<String> ids=new ArrayList<>();
            String list=m.group(3).trim();
            if(!list.isEmpty())for(String raw:list.split(",",-1)){
                String item=raw.trim();
                if(item.length()<2||!item.startsWith("\"")||!item.endsWith("\""))throw new IOException("invalid_trial_file");
                String id=item.substring(1,item.length()-1);
                if(!id.equals(key(id)))throw new IOException("invalid_trial_file");
                ids.add(id);
            }
            used=Integer.parseInt(m.group(1));unlocked=m.group(2).equals("true");
            finished=new ArrayList<>(ids.subList(Math.max(0,ids.size()-MAX_FINISHED),ids.size()));
        }catch(Exception e){
            // 손상된 기록을 0회로 되돌리지 않고 소진 상태로 본다. 개인 키나 해제는 계속 사용할 수 있다.
            used=limit;unlocked=false;finished=new ArrayList<>();
            trialError="체험 기록을 읽지 못해 기본 키 체험을 멈췄습니다. 개인 API 키를 등록해 주세요.";
        }
    }

    static boolean isUnlockCode(String text){
        if(text==null||text.length()>500)return false;
        try{
            byte[] digest=MessageDigest.getInstance("SHA-256").digest(text.trim().getBytes(StandardCharsets.UTF_8));
            StringBuilder hex=new StringBuilder();
            for(byte b:digest)hex.append(String.format(Locale.ROOT,"%02x",b&0xff));
            return hex.toString().equals(UNLOCK_SHA256);
        }catch(Exception e){return false;}
    }

    static String key(String id){return id!=null&&ID.matcher(id).matches()?id.toLowerCase(Locale.ROOT):null;}

    private void prune(){
        long time=clock.now();
        for(Iterator<Reservation> it=reservations.values().iterator();it.hasNext();)if(time-it.next().at>leaseMs)it.remove();
    }

    synchronized Status status(boolean personalKeyConfigured,boolean defaultKeyAvailable){
        prune();
        String mode;
        if(personalKeyConfigured)mode="personal";
        else if(!defaultKeyAvailable)mode="none";
        else if(unlocked)mode="unlimited";
        else if(used<limit)mode="trial";
        else mode="exhausted";
        return new Status(mode,limit,used,reservations.size(),unlocked,trialError);
    }

    // 실제 API 호출 직전에 부른다. 같은 분석 ID의 전사·분할·자동 재시도는 하나의 예약을 공유한다.
    synchronized Gate begin(String analysisId,boolean personalKeyConfigured,boolean defaultKeyAvailable){
        String mode=status(personalKeyConfigured,defaultKeyAvailable).accessMode;
        if(mode.equals("personal"))return Gate.allow("personal","personal",false);
        if(mode.equals("none"))return Gate.deny("AI_KEY_MISSING",400,"API 키를 설정해 주세요.",true);
        String id=key(analysisId);
        if(id==null)return Gate.deny("INVALID_ANALYSIS",400,"분석 식별자를 확인해 주세요.",false);
        if(mode.equals("unlimited"))return Gate.allow("default","unlimited",false);
        if(finished.contains(id))return Gate.deny("TRIAL_ID_FINISHED",409,"이미 끝난 분석입니다. 다시 분석하려면 새로 시작해 주세요.",false);
        Reservation existing=reservations.get(id);
        if(existing!=null){existing.at=clock.now();return Gate.allow("default","trial",true);}
        if(used>=limit)return Gate.deny("TRIAL_EXHAUSTED",403,EXHAUSTED_MESSAGE,true);
        if(used+reservations.size()>=limit)return Gate.deny("TRIAL_IN_USE",409,"남은 체험 횟수를 진행 중인 다른 분석이 사용하고 있습니다. 끝난 뒤 다시 시도해 주세요.",false);
        reservations.put(id,new Reservation(clock.now()));
        return Gate.allow("default","trial",true);
    }

    // 기본 키로 보낸 실제 API 요청이 성공 응답을 받았을 때 부른다. 이 표시가 없는 예약은 확정하지 않는다.
    synchronized boolean markSucceeded(String analysisId){
        String id=key(analysisId);
        prune();
        Reservation item=id==null?null:reservations.get(id);
        if(item==null)return false;
        item.succeeded=true;item.at=clock.now();
        return true;
    }

    // 최종 결과를 받은 분석만 1회로 확정한다. 저장이 성공한 뒤에만 반영하고 같은 ID는 한 번만 센다.
    synchronized Finish finish(String analysisId) throws StorageException {
        String id=key(analysisId);
        if(id==null)return new Finish(false,false);
        if(finished.contains(id))return new Finish(false,true);
        prune();
        Reservation item=reservations.get(id);
        if(item==null)return new Finish(false,false);
        if(!item.succeeded){reservations.remove(id);return new Finish(false,false);}
        List<String> nextFinished=new ArrayList<>(finished);nextFinished.add(id);
        if(nextFinished.size()>MAX_FINISHED)nextFinished=new ArrayList<>(nextFinished.subList(nextFinished.size()-MAX_FINISHED,nextFinished.size()));
        save(used+1,unlocked,nextFinished);
        used++;finished=nextFinished;reservations.remove(id);
        return new Finish(true,false);
    }

    synchronized boolean release(String analysisId){
        String id=key(analysisId);
        return id!=null&&reservations.remove(id)!=null;
    }

    synchronized void unlock() throws StorageException {
        if(unlocked)return;
        save(used,true,finished);
        unlocked=true;trialError="";
    }

    private void save(int nextUsed,boolean nextUnlocked,List<String> nextFinished) throws StorageException {
        if(stateFile==null)return;
        StringBuilder json=new StringBuilder("{\"version\":1,\"used\":").append(nextUsed).append(",\"unlocked\":").append(nextUnlocked).append(",\"finished\":[");
        for(int i=0;i<nextFinished.size();i++)json.append(i==0?"":",").append('"').append(nextFinished.get(i)).append('"');
        json.append("]}");
        File parent=stateFile.getAbsoluteFile().getParentFile();
        byte[] suffix=new byte[8];new SecureRandom().nextBytes(suffix);
        File temporary=new File(parent,stateFile.getName()+"."+String.format(Locale.ROOT,"%016x",new java.math.BigInteger(1,suffix))+".tmp");
        try{
            if(!parent.isDirectory()&&!parent.mkdirs())throw new IOException("parent");
            Files.write(temporary.toPath(),json.toString().getBytes(StandardCharsets.UTF_8));
            Files.move(temporary.toPath(),stateFile.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
        }catch(Exception e){
            throw new StorageException();
        }finally{
            temporary.delete();
        }
    }
}
