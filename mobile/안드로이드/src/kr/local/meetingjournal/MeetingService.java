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
    @Override public void onCreate(){super.onCreate();store=new Store(this);getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("meeting","회의 녹음과 분석",NotificationManager.IMPORTANCE_LOW));}
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent==null){stopSelf();return START_NOT_STICKY;}
        String action=intent.getAction();
        try{
            if("finish".equals(action)){if(recorder!=null){stopAudio();analyze();}else if(!active)stopSelf();return START_NOT_STICKY;}
            if(active)return START_NOT_STICKY;
            if("import".equals(action)){startImport(intent);return START_NOT_STICKY;}
            refining="refine".equals(action);attemptId=refining?intent.getStringExtra("attemptId"):null;
            record=new JSONObject().put("location",intent.getStringExtra("location")).put("id",intent.getStringExtra("id"));
            record=store.load(intent.getStringExtra("location"),intent.getStringExtra("id"));analyzing=refining||"analyze".equals(action);active=true;
            show(analyzing?"회의록 분석 준비 중":"회의 녹음 중",!analyzing);
            wake=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"MeetingJournal:work");wake.acquire(4*60*60*1000L);
            if(refining)refine(intent.getStringExtra("resultId"),intent.getStringExtra("feedback"));else if(analyzing)analyze();else startAudio();
        }catch(Exception ex){fail(ex);}
        finally{startingAt=0;}
        return START_NOT_STICKY;
    }
    private void show(String message,boolean microphone) {
        Intent open=new Intent(this,MainActivity.class);PendingIntent pending=PendingIntent.getActivity(this,0,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder=new Notification.Builder(this,"meeting").setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle("VoiceNote").setContentText(message).setContentIntent(pending).setOngoing(true).setOnlyAlertOnce(true);
        if(microphone){PendingIntent finish=PendingIntent.getService(this,1,new Intent(this,MeetingService.class).setAction("finish"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);builder.addAction(new Notification.Action.Builder(null,"회의 종료 · 분석",finish).build());}
        if(Build.VERSION.SDK_INT>=29)startForeground(10,builder.build(),microphone?ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE:ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);else startForeground(10,builder.build());
    }
    private void publish()throws Exception {JSONObject value=new JSONObject(record.toString());if(refining)value.put("attemptId",attemptId);snapshot=value.toString();}
    private void status(String state,String message) throws Exception {record.put("state",state).put("message",message);if(!refining)store.save(record);publish();}
    private void startAudio() throws Exception {
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
    private void analyze() throws Exception {
        analyzing=true;show("회의록 분석 중",false);status("analyzing","음성 저장 완료 · 분석을 시작합니다.");
        worker.submit(()->{try{new Ai(store,message->{status("analyzing",message);show(message,false);}).run(record);snapshot=record.toString();}catch(Exception ex){try{status("failed",safeMessage(ex));}catch(Exception ignored){}}finally{active=false;stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}});
    }
    static final String PREPARING="녹음 파일을 준비하는 중";
    private void startImport(Intent intent)throws Exception {
        // 고른 녹음 파일을 앱 안 임시 폴더에 담고, 다 담은 뒤에만 회의를 만들어 지금의 분석으로 넘긴다. 담는 동안은 회의 기록이 없어 진행 문구를 서비스 상태로만 알린다.
        Uri uri=intent.getData();String input=intent.getStringExtra("input");
        if(uri==null||input==null)throw new IOException(AudioImport.UNREADABLE);
        JSONObject fields=new JSONObject(input);
        refining=false;attemptId=null;record=null;analyzing=true;active=true;
        snapshot=new JSONObject().put("state","analyzing").put("message",PREPARING).put("createdAt",System.currentTimeMillis()).toString();
        show(PREPARING,false);
        wake=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"MeetingJournal:work");wake.acquire(4*60*60*1000L);
        worker.submit(()->importAudio(uri,fields));
    }
    private void importAudio(Uri uri,JSONObject fields){
        File temp=new File(AudioImport.tempRoot(this),UUID.randomUUID().toString());
        try{
            List<File> parts=AudioImport.store(this,uri,AudioImport.inspect(this,uri),temp);
            if(parts.size()>1){String message="녹음 파일을 "+parts.size()+"개로 나눴습니다";snapshot=new JSONObject(snapshot).put("message",message).toString();show(message,false);}
            record=store.createImported(fields,parts);
            try{store.clearDraft();}catch(Exception ignored){}
            // 회의를 실제로 만든 뒤에야 작성 중 초안을 지운다. 그 전에 실패하면 사용자가 적은 칸 값이 초안에 남는다. 초안을 못 지워도 회의는 그대로 분석한다.
            analyze();
        }catch(Exception ex){fail(ex);}
        finally{AudioImport.cleanTemp(this);}
        // 화면에서 확인한 뒤 파일이 바뀌었을 수 있어 서비스에서도 다시 판정한다. 남은 임시 폴더는 성공·실패와 관계없이 지운다.
    }
    private void refine(String resultId,String feedback)throws Exception {
        show("의견 반영 중",false);status("analyzing","저장된 전사로 의견을 반영합니다.");
        worker.submit(()->{try{new Ai(store,message->{status("analyzing",message);show(message,false);}).refine(record,resultId,feedback);publish();}catch(Exception ex){try{status("failed",safeMessage(ex));}catch(Exception ignored){}}finally{active=false;stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}});
    }
    static String safeMessage(Exception ex){
        if(ex instanceof java.net.UnknownHostException||ex instanceof java.net.ConnectException||ex instanceof java.net.NoRouteToHostException)return "인터넷에 연결할 수 없습니다. 연결을 확인한 뒤 지난 회의에서 다시 분석하세요. 녹음은 저장되어 있습니다.";
        if(ex instanceof java.net.SocketTimeoutException)return "AI 서버 응답이 늦어 중단했습니다. 잠시 후 지난 회의에서 다시 분석하세요. 녹음은 저장되어 있습니다.";
        if(ex instanceof javax.net.ssl.SSLException)return "보안 연결을 만들지 못했습니다. 네트워크를 바꿔 다시 분석하세요. 녹음은 저장되어 있습니다.";
        return ex instanceof IOException?ex.getMessage():"처리를 완료하지 못했습니다. 저장된 자료를 확인한 뒤 다시 시도하세요.";
    }
    private void fail(Exception ex){try{if(recorder!=null)stopAudio();}catch(Exception ignored){}try{if(record!=null)status("failed",safeMessage(ex));else snapshot=new JSONObject().put("state","failed").put("message",safeMessage(ex)).toString();}catch(Exception ignored){}active=false;stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}
    // 녹음 파일을 담다가 회의를 만들기 전에 실패하면 회의 기록이 없으므로 서비스 상태에만 실패 안내를 싣는다.
    @Override public void onTimeout(int startId,int type){fail(new IOException("백그라운드 작업 시간이 끝났습니다. 저장된 자료에서 다시 분석하세요."));}
    @Override public void onDestroy(){try{if(recorder!=null){stopAudio();status("interrupted","녹음이 중단되었습니다. 저장된 음성으로 다시 분석할 수 있습니다.");}}catch(Exception ignored){}worker.shutdownNow();if(wake!=null&&wake.isHeld())wake.release();active=false;super.onDestroy();}
}
