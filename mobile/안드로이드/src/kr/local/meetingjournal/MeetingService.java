// 알림을 유지하며 화면이 꺼져도 녹음하고 종료 후 전사와 요약을 실행한다.
package kr.local.meetingjournal;
import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.media.MediaRecorder;
import android.os.*;
import org.json.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

public final class MeetingService extends Service {
    static volatile String snapshot="{}";
    static volatile boolean active=false;
    private Store store; private JSONObject record; private MediaRecorder recorder; private PowerManager.WakeLock wake;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private boolean analyzing=false,refining=false; private File audioFile;
    @Override public void onCreate(){super.onCreate();store=new Store(this);getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("meeting","회의 녹음과 분석",NotificationManager.IMPORTANCE_LOW));}
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent==null){stopSelf();return START_NOT_STICKY;}
        String action=intent.getAction();
        try{
            if("finish".equals(action)){if(recorder!=null){stopAudio();analyze();}else if(!active)stopSelf();return START_NOT_STICKY;}
            if(active)return START_NOT_STICKY;
            record=store.load(intent.getStringExtra("location"),intent.getStringExtra("id"));refining="refine".equals(action);analyzing=refining||"analyze".equals(action);active=true;
            show(analyzing?"회의록 분석 준비 중":"회의 녹음 중",!analyzing);
            wake=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"MeetingJournal:work");wake.acquire(4*60*60*1000L);
            if(refining)refine(intent.getStringExtra("resultId"),intent.getStringExtra("feedback"));else if(analyzing)analyze();else startAudio();
        }catch(Exception ex){fail(ex);}
        return START_NOT_STICKY;
    }
    private void show(String message,boolean microphone) {
        Intent open=new Intent(this,MainActivity.class);PendingIntent pending=PendingIntent.getActivity(this,0,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder=new Notification.Builder(this,"meeting").setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle("VoiceNote").setContentText(message).setContentIntent(pending).setOngoing(true).setOnlyAlertOnce(true);
        if(microphone){PendingIntent finish=PendingIntent.getService(this,1,new Intent(this,MeetingService.class).setAction("finish"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);builder.addAction(new Notification.Action.Builder(null,"회의 종료 · 분석",finish).build());}
        if(Build.VERSION.SDK_INT>=29)startForeground(10,builder.build(),microphone?ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE:ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);else startForeground(10,builder.build());
    }
    private void status(String state,String message) throws Exception {record.put("state",state).put("message",message);if(!refining)store.save(record);snapshot=record.toString();}
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
    private void refine(String resultId,String feedback)throws Exception {
        show("의견 반영 중",false);status("analyzing","저장된 전사로 의견을 반영합니다.");
        worker.submit(()->{try{new Ai(store,message->{status("analyzing",message);show(message,false);}).refine(record,resultId,feedback);snapshot=record.toString();}catch(Exception ex){try{status("failed",safeMessage(ex));}catch(Exception ignored){}}finally{active=false;stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}});
    }
    static String safeMessage(Exception ex){
        if(ex instanceof java.net.UnknownHostException||ex instanceof java.net.ConnectException||ex instanceof java.net.NoRouteToHostException)return "인터넷에 연결할 수 없습니다. 연결을 확인한 뒤 지난 회의에서 다시 분석하세요. 녹음은 저장되어 있습니다.";
        if(ex instanceof java.net.SocketTimeoutException)return "AI 서버 응답이 늦어 중단했습니다. 잠시 후 지난 회의에서 다시 분석하세요. 녹음은 저장되어 있습니다.";
        if(ex instanceof javax.net.ssl.SSLException)return "보안 연결을 만들지 못했습니다. 네트워크를 바꿔 다시 분석하세요. 녹음은 저장되어 있습니다.";
        return ex instanceof IOException?ex.getMessage():"처리를 완료하지 못했습니다. 저장된 자료를 확인한 뒤 다시 시도하세요.";
    }
    private void fail(Exception ex){try{if(recorder!=null)stopAudio();}catch(Exception ignored){}try{if(record!=null)status("failed",safeMessage(ex));}catch(Exception ignored){}active=false;stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}
    @Override public void onTimeout(int startId,int type){fail(new IOException("백그라운드 작업 시간이 끝났습니다. 저장된 자료에서 다시 분석하세요."));}
    @Override public void onDestroy(){try{if(recorder!=null){stopAudio();status("interrupted","녹음이 중단되었습니다. 저장된 음성으로 다시 분석할 수 있습니다.");}}catch(Exception ignored){}worker.shutdownNow();if(wake!=null&&wake.isHeld())wake.release();active=false;super.onDestroy();}
}
