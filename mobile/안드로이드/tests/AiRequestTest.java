// OpenAI 요청 감시(AiRequest)가 올리기 멈춤·응답 없음·늦은 감시·실제 소켓의 막힌 쓰기를 정해진 규칙대로 끊고 받는지 검증한다.
package kr.local.meetingjournal;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public final class AiRequestTest {
    static final AiRequest.Limits FAST = new AiRequest.Limits(300, 600, 20);
    static int checks;

    static void expect(boolean ok, String name) { if (!ok) throw new AssertionError(name); checks++; }

    /** 시험이 막힘과 풀림을 정하는 가짜 연결. disconnect가 막힌 스트림을 IOException으로 푼다. */
    static final class FakeConnection extends HttpURLConnection {
        final Object gate = new Object();
        volatile boolean closed;
        volatile boolean releasedByDisconnect;
        volatile int disconnects;
        int writesBeforeBlock = Integer.MAX_VALUE;
        boolean blockOnClose, blockOnResponse, trickle;
        long responseDelayMillis;
        String responseBody = "{\"ok\":true}";

        FakeConnection() throws MalformedURLException { super(new URL("http://127.0.0.1/fake")); }
        @Override public void connect() {}
        @Override public boolean usingProxy() { return false; }
        @Override public void disconnect() {
            disconnects++;
            synchronized (gate) { closed = true; gate.notifyAll(); }
        }
        void blockUntilClosed() throws IOException {
            synchronized (gate) {
                while (!closed) { try { gate.wait(50); } catch (InterruptedException ex) { Thread.currentThread().interrupt(); throw new InterruptedIOException(); } }
            }
            releasedByDisconnect = true;
            throw new IOException("Socket closed");
        }
        @Override public OutputStream getOutputStream() {
            return new OutputStream() {
                int writes;
                @Override public void write(int b) throws IOException { write(new byte[]{(byte) b}, 0, 1); }
                @Override public void write(byte[] b, int off, int len) throws IOException {
                    if (closed) throw new IOException("Socket closed");
                    if (writes++ >= writesBeforeBlock) blockUntilClosed();
                }
                @Override public void close() throws IOException { if (blockOnClose) blockUntilClosed(); }
            };
        }
        @Override public int getResponseCode() throws IOException {
            if (blockOnResponse) blockUntilClosed();
            if (responseDelayMillis > 0) { try { Thread.sleep(responseDelayMillis); } catch (InterruptedException ex) { throw new InterruptedIOException(); } }
            return 200;
        }
        @Override public InputStream getInputStream() {
            if (!trickle) return new ByteArrayInputStream(responseBody.getBytes(StandardCharsets.UTF_8));
            return new InputStream() {
                @Override public int read() throws IOException {
                    try { Thread.sleep(100); } catch (InterruptedException ex) { throw new InterruptedIOException(); }
                    if (closed) { releasedByDisconnect = true; throw new IOException("Socket closed"); }
                    return 'a';
                }
            };
        }
    }

    static final class Recorder implements AiRequest.Listener {
        final List<String> events = new ArrayList<>();
        @Override public synchronized void connected() { events.add("connected"); }
        @Override public synchronized void wrote(long sent) { events.add("wrote"); }
        @Override public synchronized void uploaded() { events.add("uploaded"); }
    }

    static final AiRequest.Body SMALL_BODY = (out, wrote) -> { byte[] chunk = new byte[8192]; for (int i = 1; i <= 4; i++) { out.write(chunk); wrote.accept(i * 8192L); } };

    static IOException failureOf(FakeConnection connection, AiRequest.Limits limits) {
        long started = System.nanoTime();
        try { AiRequest.exchange(connection, SMALL_BODY, new Recorder(), limits); }
        catch (IOException ex) {
            expect((System.nanoTime() - started) / 1_000_000 < 2000, "2초 안에 끊음");
            return ex;
        }
        throw new AssertionError("실패해야 할 요청이 끝났습니다");
    }

    static void noGuardLeft(String name) {
        for (int i = 0; i < 50; i++) {
            boolean alive = false;
            for (Thread thread : Thread.getAllStackTraces().keySet()) if (thread.getName().equals("AiRequest감시") && thread.isAlive()) alive = true;
            if (!alive) { checks++; return; }
            try { Thread.sleep(20); } catch (InterruptedException ex) { Thread.currentThread().interrupt(); }
        }
        throw new AssertionError("감시 스레드가 남음: " + name);
    }

    static long ms(long value) { return value * 1_000_000L; }

    public static void main(String[] args) throws Exception {
        // 1. 쓰기 중간에 멈추면 올리기 멈춤
        FakeConnection middle = new FakeConnection(); middle.writesBeforeBlock = 2;
        expect(failureOf(middle, FAST) instanceof AiRequest.Stalled, "쓰기 중간 멈춤은 Stalled");
        expect(middle.releasedByDisconnect && middle.disconnects >= 1, "감시가 연결을 끊어 막힌 쓰기를 풂");
        noGuardLeft("쓰기 중간");
        // 2. 첫 쓰기부터 멈추면 올리기 멈춤
        FakeConnection first = new FakeConnection(); first.writesBeforeBlock = 0;
        expect(failureOf(first, FAST) instanceof AiRequest.Stalled, "첫 쓰기 멈춤은 Stalled");
        noGuardLeft("첫 쓰기");
        // 3. 본문을 닫다가 멈추면 올리기 멈춤
        FakeConnection closing = new FakeConnection(); closing.blockOnClose = true;
        expect(failureOf(closing, FAST) instanceof AiRequest.Stalled, "닫기 멈춤은 Stalled");
        noGuardLeft("닫기");
        // 4. 응답이 오지 않으면 응답 없음
        FakeConnection silent = new FakeConnection(); silent.blockOnResponse = true;
        IOException none = failureOf(silent, FAST);
        expect(none instanceof SocketTimeoutException && !(none instanceof AiRequest.Stalled), "무응답은 SocketTimeoutException");
        noGuardLeft("무응답");
        // 5. 응답이 조금씩 와도 전체 제한을 넘으면 응답 없음
        FakeConnection trickle = new FakeConnection(); trickle.trickle = true;
        expect(failureOf(trickle, FAST) instanceof SocketTimeoutException, "조금씩 오는 응답도 전체 제한에서 끊음");
        noGuardLeft("조금씩");
        // 6. 제한 직전에 다 읽으면 받음
        FakeConnection quick = new FakeConnection(); quick.responseDelayMillis = 450;
        Recorder order = new Recorder();
        AiRequest.Response response = AiRequest.exchange(quick, SMALL_BODY, order, FAST);
        expect(response.status == 200 && response.body.equals("{\"ok\":true}"), "제한 직전 응답은 받음");
        expect(order.events.get(0).equals("connected") && order.events.get(order.events.size() - 1).equals("uploaded") && order.events.subList(1, order.events.size() - 1).stream().allMatch("wrote"::equals) && order.events.size() == 6, "listener 순서 " + order.events);
        noGuardLeft("제한 직전");
        // 7. 감시가 늦게 돌아도 먼저 다 읽었으면 받음
        FakeConnection late = new FakeConnection(); late.responseDelayMillis = 650;
        expect(AiRequest.exchange(late, SMALL_BODY, new Recorder(), new AiRequest.Limits(300, 600, 1000)).status == 200, "늦은 감시보다 먼저 다 읽으면 받음");
        noGuardLeft("늦은 감시");
        // 8. 상대가 읽지 않는 실제 연결의 막힌 쓰기도 풀린다
        try (ServerSocket server = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
            Thread acceptor = new Thread(() -> { try { Socket held = server.accept(); Thread.sleep(5000); held.close(); } catch (Exception ignored) {} });
            acceptor.setDaemon(true); acceptor.start();
            HttpURLConnection real = (HttpURLConnection) new URL("http://127.0.0.1:" + server.getLocalPort() + "/v1/stall").openConnection();
            real.setRequestMethod("POST"); real.setDoOutput(true); real.setChunkedStreamingMode(8192); real.setConnectTimeout(3000); real.setReadTimeout(10000);
            long started = System.nanoTime();
            try {
                AiRequest.exchange(real, (out, wrote) -> { byte[] chunk = new byte[8192]; long sent = 0; for (int i = 0; i < 8192; i++) { out.write(chunk); sent += chunk.length; wrote.accept(sent); } }, new Recorder(), FAST);
                throw new AssertionError("실제 연결의 막힌 쓰기가 끝나면 안 됩니다");
            } catch (AiRequest.Stalled expected) {
                expect((System.nanoTime() - started) / 1_000_000 < 3000, "실제 소켓도 3초 안에 풂");
            }
        }
        noGuardLeft("실제 소켓");
        // 9. 진행이 먼저 잠금을 잡으면 감시는 끊지 않는다
        AiRequest.Watch progressFirst = new AiRequest.Watch(FAST, 0);
        expect(progressFirst.progress(ms(290)), "진행 갱신");
        expect(progressFirst.check(ms(310)) == AiRequest.RUNNING, "진행 뒤 20ms는 계속");
        expect(progressFirst.check(ms(591)) == AiRequest.STALLED, "진행 뒤 301ms는 멈춤");
        // 10. 감시가 먼저 확정하면 뒤 진행은 되살리지 않는다
        AiRequest.Watch watchFirst = new AiRequest.Watch(FAST, 0);
        expect(watchFirst.check(ms(301)) == AiRequest.STALLED, "301ms 진행 없음은 멈춤");
        expect(!watchFirst.progress(ms(302)) && watchFirst.state() == AiRequest.STALLED, "확정 뒤 진행은 무시");
        // 11. 다 읽음이 먼저면 감시는 아무것도 바꾸지 않는다
        AiRequest.Watch doneFirst = new AiRequest.Watch(FAST, 0);
        expect(doneFirst.uploaded(ms(100)) && doneFirst.complete(), "다 읽음 확정");
        expect(doneFirst.check(ms(10_000)) == AiRequest.DONE, "확정 뒤 감시는 그대로");
        // 12. 응답 단계의 기준은 다 올린 시각이다
        AiRequest.Watch waiting = new AiRequest.Watch(FAST, 0);
        expect(waiting.uploaded(ms(1_000)), "다 올림");
        expect(waiting.check(ms(1_550)) == AiRequest.RUNNING, "다 올린 뒤 550ms는 계속");
        expect(waiting.check(ms(1_601)) == AiRequest.TIMED_OUT, "다 올린 뒤 601ms는 응답 없음");
        System.out.println("PASS " + checks + " AiRequest checks");
    }
}
