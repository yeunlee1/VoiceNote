// OpenAI 요청 하나의 본문 보내기와 응답 받기를 올리기 60초·응답 5분 감시와 함께 처리한다.
package kr.local.meetingjournal;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import java.util.function.LongConsumer;

final class AiRequest {
    interface Listener {void connected(); void wrote(long sent); void uploaded();}
    interface Body {void write(OutputStream out,LongConsumer wrote)throws IOException;}

    static final class Limits {
        final long stallNanos,responseNanos,tickMillis;
        Limits(long stallMillis,long responseMillis,long tickMillis){stallNanos=TimeUnit.MILLISECONDS.toNanos(stallMillis);responseNanos=TimeUnit.MILLISECONDS.toNanos(responseMillis);this.tickMillis=tickMillis;}
        static final Limits DEFAULT=new Limits(60_000,300_000,500);
    }
    static final class Stalled extends IOException {Stalled(){super("요청을 보내다 1분 넘게 멈춰 중단했습니다. 인터넷 연결을 확인한 뒤 다시 분석하세요. 저장된 자료는 유지됩니다.");}}
    static final class Response {final int status;final String body;Response(int status,String body){this.status=status;this.body=body;}}

    static final int RUNNING=0,DONE=1,STALLED=2,TIMED_OUT=3;

    static final class Watch {
        // 상태·단계·마지막 진행 시각을 한 잠금 안에서 함께 읽고 바꾼다. 감시가 옛 시각을 읽은 사이 생긴 진행에 끊기지 않게 하기 위함이다.
        private final Limits limits;private int state=RUNNING;private boolean waiting;private long lastProgress,uploadedAt;
        Watch(Limits limits,long now){this.limits=limits;lastProgress=now;}
        synchronized boolean progress(long now){if(state!=RUNNING)return false;lastProgress=now;return true;}
        synchronized boolean uploaded(long now){if(state!=RUNNING)return false;waiting=true;uploadedAt=now;return true;}
        synchronized int check(long now){
            if(state!=RUNNING)return state;
            if(!waiting&&now-lastProgress>limits.stallNanos)state=STALLED;
            else if(waiting&&now-uploadedAt>limits.responseNanos)state=TIMED_OUT;
            return state;
        }
        synchronized boolean complete(){if(state!=RUNNING)return false;state=DONE;return true;}
        synchronized int state(){return state;}
    }

    static IOException failure(int state,IOException cause){
        IOException failure=state==STALLED?new Stalled():new SocketTimeoutException("응답 없음");
        if(cause!=null)failure.initCause(cause);return failure;
    }

    static Response exchange(HttpURLConnection connection,Body body,Listener listener,Limits limits)throws IOException {
        Watch watch=new Watch(limits,System.nanoTime());
        ScheduledExecutorService guard=Executors.newSingleThreadScheduledExecutor(task->{Thread thread=new Thread(task,"AiRequest감시");thread.setDaemon(true);return thread;});
        guard.scheduleWithFixedDelay(()->{
            if(watch.state()!=RUNNING)return;
            int decided=watch.check(System.nanoTime());
            if(decided==STALLED||decided==TIMED_OUT)connection.disconnect();
            // 감시가 확정한 경우에만 연결을 닫아 막힌 쓰기·읽기를 풀고, 요청 스레드가 그 예외를 멈춤·응답 없음으로 바꾼다.
        },limits.tickMillis,limits.tickMillis,TimeUnit.MILLISECONDS);
        IOException failed=null;Response response=null;
        try{
            OutputStream out=connection.getOutputStream();
            watch.progress(System.nanoTime());listener.connected();
            body.write(out,sent->{watch.progress(System.nanoTime());listener.wrote(sent);});
            out.close();
            watch.progress(System.nanoTime());
            watch.uploaded(System.nanoTime());listener.uploaded();
            int status=connection.getResponseCode();String text;
            try(InputStream in=status<400?connection.getInputStream():connection.getErrorStream()){text=in==null?"{}":read(in);}
            if(watch.complete())response=new Response(status,text);else failed=failure(watch.state(),null);
        }catch(IOException ex){
            int state=watch.state();
            failed=state==STALLED||state==TIMED_OUT?failure(state,ex):ex;
        }finally{
            guard.shutdownNow();
            try{guard.awaitTermination(2,TimeUnit.SECONDS);}catch(InterruptedException ex){Thread.currentThread().interrupt();}
            connection.disconnect();
        }
        if(failed!=null)throw failed;
        return response;
    }

    static String read(InputStream in)throws IOException {
        ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[8192];
        for(int n;(n=in.read(buffer))!=-1;)out.write(buffer,0,n);
        return new String(out.toByteArray(),StandardCharsets.UTF_8);
    }
}
