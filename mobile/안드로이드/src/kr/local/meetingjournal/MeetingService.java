// 알림을 유지하며 화면이 꺼져도 녹음하고 종료 후 전사와 요약을 실행한다.
package kr.local.meetingjournal;
import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.media.MediaRecorder;
import android.net.Uri;
import android.os.*;
import org.json.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

public final class MeetingService extends Service {
    static volatile String snapshot="{}";
    static volatile boolean active=false;
    // 화면이 서비스 시작을 요청한 시각이다. active가 켜지기 전 잠깐 동안 앱 업데이트 설치가 끼어들지 못하게 한다. 서비스가 요청을 받으면 지운다.
    static volatile long startingAt=0;
    static boolean starting(){return startingAt!=0&&System.currentTimeMillis()-startingAt<15000;}
    private Store store; private JSONObject record; private MediaRecorder recorder; private PowerManager.WakeLock wake;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private boolean analyzing=false,refining=false; private File audioFile; private String attemptId;
    private ActivityLog activity; private volatile long published; private String notified="";
    // 이번 작업의 AI 요청 일지와, 화면 상태를 마지막으로 쓴 시각·알림에 건 열린 요청(이름|단계)이다. 일지는 화면 상태에만 싣고 회의 파일에는 저장하지 않는다.
    @Override public void onCreate(){super.onCreate();store=new Store(this);getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("meeting","회의 녹음과 분석",NotificationManager.IMPORTANCE_LOW));}
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent==null){stopSelf();return START_NOT_STICKY;}
        String action=intent.getAction();
        try{
            if("finish".equals(action)){if(recorder!=null){stopAudio();if(intent.getBooleanExtra("hold",false))hold();else analyze("minutes");}else if(!active)stopSelf();return START_NOT_STICKY;}
            if(active)return START_NOT_STICKY;
            if("import".equals(action)){startImport(intent);return START_NOT_STICKY;}
            refining="refine".equals(action);attemptId=(refining||"analyze".equals(action))?intent.getStringExtra("attemptId"):null;
            record=new JSONObject().put("location",intent.getStringExtra("location")).put("id",intent.getStringExtra("id"));
            record=store.load(intent.getStringExtra("location"),intent.getStringExtra("id"));analyzing=refining||"analyze".equals(action);active=true;
            show(analyzing?"회의록 분석 준비 중":"회의 녹음 중",!analyzing);
            wake=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"MeetingJournal:work");wake.acquire(4*60*60*1000L);
            if(refining)refine(intent.getStringExtra("resultId"),intent.getStringExtra("feedback"));else if(analyzing)analyze(mode(intent.getStringExtra("mode")));else startAudio();
        }catch(Exception ex){fail(ex);}
        finally{startingAt=0;}
        return START_NOT_STICKY;
    }
    private void show(String message,boolean microphone){show(message,microphone,0);}
    private void show(String message,boolean microphone,long since) {
        // since가 있으면 그 시각부터 알림 시간이 1초씩 올라간다(열린 AI 요청). 없으면 지금처럼 글만 보인다.
        Intent open=new Intent(this,MainActivity.class);PendingIntent pending=PendingIntent.getActivity(this,0,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder=new Notification.Builder(this,"meeting").setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle("VoiceNote").setContentText(message).setContentIntent(pending).setOngoing(true).setOnlyAlertOnce(true);
        if(since>0)builder.setWhen(since).setUsesChronometer(true).setShowWhen(true);
        if(microphone){PendingIntent finish=PendingIntent.getService(this,1,new Intent(this,MeetingService.class).setAction("finish"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);builder.addAction(new Notification.Action.Builder(null,"회의 종료 · 분석",finish).build());}
        if(Build.VERSION.SDK_INT>=29)startForeground(10,builder.build(),microphone?ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE:ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);else startForeground(10,builder.build());
    }
    private void publish()throws Exception {JSONObject value=new JSONObject(record.toString());if(activity!=null)value.put("activity",new JSONObject(activity.json()));if(attemptId!=null)value.put("attemptId",attemptId);snapshot=value.toString();published=System.currentTimeMillis();}
    // 의견 반영과 녹음 파일 불러오기는 시도 번호를 상태에 실어, 화면이 앞선 회의의 상태와 이번 시도의 상태를 구분하게 한다. 다른 동작은 시도 번호가 없다.
    private void status(String state,String message) throws Exception {record.put("state",state).put("message",message);if(!refining)store.save(record);publish();}
    private ActivityLog newActivity(String kind){
        // 작업마다 일지를 새로 만든다. 줄·열린 요청이 바뀌면 화면 상태에 바로 싣고, 올린 양만 바뀌면 마지막으로 쓴 뒤 1초가 지났을 때만 싣는다.
        notified="";
        return new ActivityLog(kind,structural->{
            if(!structural&&System.currentTimeMillis()-published<1000)return;
            try{publishActivity();}catch(Exception ignored){}
            if(structural)notifyRequest();
        });
    }
    private void publishActivity()throws Exception {
        // 일지 변경으로는 회의 파일을 저장하지 않는다. 회의가 아직 없으면(녹음 파일 준비 중) 지금 상태 글에 일지만 넣어 다시 쓴다.
        if(record!=null){publish();return;}
        JSONObject value=new JSONObject(snapshot);value.put("activity",activity==null?JSONObject.NULL:new JSONObject(activity.json()));snapshot=value.toString();published=System.currentTimeMillis();
    }
    private void notifyRequest(){
        // 열린 요청의 이름이나 단계가 바뀔 때만 알림을 새로 건다. 올리기는 보낸 때부터, 기다림은 다 올린 때부터 알림 시간이 올라간다.
        try{
            JSONObject open=activity==null?null:new JSONObject(activity.json()).optJSONObject("open");
            String key=open==null?"":open.optString("label")+"|"+open.optString("phase");
            if(key.equals(notified))return;notified=key;
            if(open==null){show(record!=null?record.optString("message"):new JSONObject(snapshot).optString("message"),false);return;}
            boolean upload="upload".equals(open.optString("phase"));
            show(open.optString("label")+(upload?" 음성 올리는 중":" 응답 기다리는 중"),false,upload?open.optLong("since"):open.optLong("waitSince"));
        }catch(Exception ignored){}
    }
    private void recordFailure(Exception ex){
        // 기존 실패 처리와 따로, 요청 쪽이 실패 줄을 적지 않은 오류만 지금 오류 문구로 일지에 남긴다. 녹음처럼 일지가 없는 실패는 건너뛴다.
        if(activity==null)return;
        ActivityLog.failOnce(activity,safeMessage(ex));
        try{publishActivity();}catch(Exception ignored){}
    }
    private void startAudio() throws Exception {
        activity=null;
        // 새 녹음은 새 회의라 앞 작업의 일지를 화면 상태에서 뺀다.
        JSONArray audio=record.getJSONArray("audio");String name=String.format(Locale.ROOT,"원음-%03d.m4a",audio.length()+1);audioFile=new File(store.directory(Store.location(record),record.getString("id")),name);
        recorder=new MediaRecorder();recorder.setAudioSource(MediaRecorder.AudioSource.MIC);recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);recorder.setAudioChannels(1);recorder.setAudioSamplingRate(24000);recorder.setAudioEncodingBitRate(64000);recorder.setOutputFile(audioFile.getAbsolutePath());recorder.setMaxDuration(20*60*1000);recorder.setMaxFileSize(22*1024*1024);
        recorder.setOnInfoListener((r,what,extra)->{if(what==MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED||what==MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED){try{stopAudio();startAudio();}catch(Exception ex){fail(ex);}}});
        recorder.setOnErrorListener((r,what,extra)->fail(new IOException("녹음이 중단되었습니다. 저장된 파일을 확인하세요.")));
        recorder.prepare();recorder.start();audio.put(name);status("recording","회의 녹음 중 · 종료 버튼을 누르면 자동 분석합니다.");
    }
    private void stopAudio() throws Exception {
        if(recorder==null)return;MediaRecorder current=recorder;recorder=null;
        try{current.setOnInfoListener(null);current.setOnErrorListener(null);current.stop();}catch(RuntimeException ex){throw new IOException("녹음이 너무 짧거나 마이크가 중단되었습니다. 남은 원음은 보관했습니다.");}finally{current.release();}
        if(audioFile==null||audioFile.length()==0)throw new IOException("저장된 음성이 없습니다.");
        status("saved","음성 저장 완료");
    }
    static String mode(String value) throws IOException {
        // 화면이 고른 분석 방식이다. 값이 없으면 지금처럼 회의록까지(minutes)이고, 전사까지만(transcript) 말고 다른 값은 받지 않는다.
        if(value==null||value.isEmpty()||"minutes".equals(value))return "minutes";
        if("transcript".equals(value))return "transcript";
        throw new IOException("분석 방식을 확인할 수 없습니다.");
    }
    private void hold(){
        // 화면의 회의 종료는 녹음을 저장만 하고 서비스를 끝낸다. 화면이 방식을 고른 뒤 analyze로 다시 시작한다.
        active=false;stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();
    }
    private void analyze(String mode) throws Exception {analyze(mode,null);}
    private void analyze(String mode,ActivityLog imported) throws Exception {
        // 불러오기는 녹음 파일을 나눈 줄이 든 일지를 넘기고, 그 밖의 분석은 여기서 일지를 새로 만든다.
        boolean transcriptOnly="transcript".equals(mode);
        activity=imported!=null?imported:newActivity(transcriptOnly?"transcript":"analysis");ActivityLog log=activity;
        analyzing=true;show(transcriptOnly?"전사 중":"회의록 분석 중",false);status("analyzing",transcriptOnly?"음성 저장 완료 · 전사를 시작합니다.":"음성 저장 완료 · 분석을 시작합니다.");
        log.attach(Store.location(record),record.getString("id"),null);
        // 분석이 만들 결과는 아직 없어 결과 번호는 비운다. 「분석 중」 상태를 쓴 뒤에 붙여, 불러오기 준비 상태가 회의 파일의 첫 상태로 잠깐 바뀌어 보이지 않게 한다.
        worker.submit(()->{try{Ai ai=new Ai(store,message->{status("analyzing",message);show(message,false);});ai.log=log;if(transcriptOnly)ai.transcribeOnly(record);else ai.run(record);publish();}catch(Exception ex){try{status("failed",safeMessage(ex));}catch(Exception ignored){}recordFailure(ex);}finally{active=false;stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}});
    }
    static final String PREPARING="녹음 파일을 준비하는 중";
    private void startImport(Intent intent)throws Exception {
        // 고른 녹음 파일을 앱 안 임시 폴더에 담고, 다 담은 뒤에만 회의를 만들어 지금의 분석으로 넘긴다. 담는 동안은 회의 기록이 없어 진행 문구를 서비스 상태로만 알린다.
        Uri uri=intent.getData();String input=intent.getStringExtra("input");
        if(uri==null||input==null)throw new IOException(AudioImport.UNREADABLE);
        JSONObject fields=new JSONObject(input);
        String attempt=intent.getStringExtra("attemptId");
        if(attempt==null||attempt.isEmpty())throw new IOException("불러오기 시도를 확인할 수 없습니다. 다시 시도하세요.");
        refining=false;attemptId=attempt;record=null;analyzing=true;active=true;
        activity=newActivity("transcript".equals(fields.optString("mode",null))?"transcript":"analysis");
        snapshot=new JSONObject().put("state","analyzing").put("message",PREPARING).put("createdAt",System.currentTimeMillis()).put("attemptId",attemptId).toString();
        show(PREPARING,false);
        wake=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"MeetingJournal:work");wake.acquire(4*60*60*1000L);
        worker.submit(()->importAudio(uri,fields));
    }
    private void importAudio(Uri uri,JSONObject fields){
        File temp=new File(AudioImport.tempRoot(this),UUID.randomUUID().toString());
        try{
            List<File> parts=AudioImport.store(this,uri,AudioImport.inspect(this,uri),temp);
            if(parts.size()>1){activity.add("splitImport",ActivityLog.fields("total",parts.size()));String message="녹음 파일을 "+parts.size()+"개로 나눴습니다";snapshot=new JSONObject(snapshot).put("message",message).toString();show(message,false);}
            record=store.createImported(fields,parts);
            try{store.clearDraft();}catch(Exception ignored){}
            // 회의를 실제로 만든 뒤에야 작성 중 초안을 지운다. 그 전에 실패하면 사용자가 적은 칸 값이 초안에 남는다. 초안을 못 지워도 회의는 그대로 분석한다.
            analyze(mode(fields.optString("mode",null)),activity);
        }catch(Exception ex){fail(ex);}
        finally{AudioImport.cleanTemp(this);}
        // 화면에서 확인한 뒤 파일이 바뀌었을 수 있어 서비스에서도 다시 판정한다. 남은 임시 폴더는 성공·실패와 관계없이 지운다.
    }
    private void refine(String resultId,String feedback)throws Exception {
        activity=newActivity("refine");ActivityLog log=activity;
        show("의견 반영 중",false);status("analyzing","저장된 전사로 의견을 반영합니다.");
        log.attach(Store.location(record),record.getString("id"),resultId);
        worker.submit(()->{try{Ai ai=new Ai(store,message->{status("analyzing",message);show(message,false);});ai.log=log;ai.refine(record,resultId,feedback);publish();}catch(Exception ex){try{status("failed",safeMessage(ex));}catch(Exception ignored){}recordFailure(ex);}finally{active=false;stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}});
    }
    static String safeMessage(Exception ex){
        if(ex instanceof java.net.UnknownHostException||ex instanceof java.net.ConnectException||ex instanceof java.net.NoRouteToHostException)return "인터넷에 연결할 수 없습니다. 연결을 확인한 뒤 지난 회의에서 다시 분석하세요. 녹음은 저장되어 있습니다.";
        if(ex instanceof java.net.SocketTimeoutException)return "AI 서버 응답이 늦어 중단했습니다. 잠시 후 지난 회의에서 다시 분석하세요. 녹음은 저장되어 있습니다.";
        if(ex instanceof javax.net.ssl.SSLException)return "보안 연결을 만들지 못했습니다. 네트워크를 바꿔 다시 분석하세요. 녹음은 저장되어 있습니다.";
        return ex instanceof IOException?ex.getMessage():"처리를 완료하지 못했습니다. 저장된 자료를 확인한 뒤 다시 시도하세요.";
    }
    private void fail(Exception ex){try{if(recorder!=null)stopAudio();}catch(Exception ignored){}try{if(record!=null)status("failed",safeMessage(ex));else{JSONObject failed=new JSONObject().put("state","failed").put("message",safeMessage(ex));if(attemptId!=null)failed.put("attemptId",attemptId);snapshot=failed.toString();}}catch(Exception ignored){}recordFailure(ex);active=false;stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}
    // 녹음 파일을 담다가 회의를 만들기 전에 실패하면 회의 기록이 없으므로 서비스 상태에만 실패 안내를 싣는다.
    @Override public void onTimeout(int startId,int type){fail(new IOException("백그라운드 작업 시간이 끝났습니다. 저장된 자료에서 다시 분석하세요."));}
    @Override public void onDestroy(){try{if(recorder!=null){stopAudio();status("interrupted","녹음이 중단되었습니다. 저장된 음성으로 다시 분석할 수 있습니다.");}}catch(Exception ignored){}worker.shutdownNow();if(wake!=null&&wake.isHeld())wake.release();active=false;super.onDestroy();}
}
