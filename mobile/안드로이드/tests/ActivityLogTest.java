// 휴대폰 진행 기록(ActivityLog)이 데스크톱과 같은 문구를 만들고 30줄·순서·열린 요청·회의 붙이기·실패 한 번 규칙을 지키는지 검증한다.
package kr.local.meetingjournal;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

public final class ActivityLogTest {
    static int checks;
    static void expect(boolean ok, String name) { if (!ok) throw new AssertionError(name); checks++; }

    @SuppressWarnings("unchecked")
    static Map<String, Object> parse(String json) throws Exception { return (Map<String, Object>) new JsonText.Parser(json).document(); }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) throws Exception {
        Map<String, Object> cases = parse(new String(Files.readAllBytes(Paths.get(args[0])), StandardCharsets.UTF_8));
        // 공통 예시의 줄 문구와 요청 이름이 데스크톱과 같다
        for (Object item : (List<Object>) cases.get("lines")) {
            Map<String, Object> c = (Map<String, Object>) item, event = (Map<String, Object>) c.get("event");
            String text = ActivityLog.lineText((String) event.get("type"), event);
            expect(text.equals(c.get("text")), "줄 문구 " + event + " → " + text);
        }
        for (Object item : (List<Object>) cases.get("labels")) {
            Map<String, Object> c = (Map<String, Object>) item, event = (Map<String, Object>) c.get("event");
            expect(ActivityLog.requestLabel((String) event.get("type"), event).equals(c.get("label")), "요청 이름 " + event);
        }
        // 30줄을 넘으면 앞에서 버리고 순서 번호는 이어진다
        ActivityLog many = new ActivityLog("analysis", null);
        for (int i = 1; i <= 31; i++) { Map<String, Object> f = new HashMap<>(); f.put("part", i); f.put("total", 31); many.add("saveAudio", f); }
        List<ActivityLog.Entry> kept = many.entries();
        expect(kept.size() == ActivityLog.MAX_ENTRIES && kept.get(0).seq == 2 && kept.get(kept.size() - 1).seq == 31, "30줄 넘으면 앞에서 버림");
        expect(kept.get(kept.size() - 1).text.equals("음성 저장함 · 31/31개"), "마지막 줄 문구");
        // 줄은 순서 번호로 모두 남는다
        ActivityLog quick = new ActivityLog("analysis", null);
        quick.add("sendCompact", null); quick.add("recvCompact", null); quick.add("savedMinutes", null);
        List<Object> entries = (List<Object>) parse(quick.json()).get("entries");
        expect(entries.size() == 3, "세 줄 모두 snapshot에 있음");
        for (int i = 0; i < 3; i++) expect(((Number) ((Map<String, Object>) entries.get(i)).get("seq")).intValue() == i + 1, "순서 번호 " + (i + 1));
        // 열린 요청은 올리기에서 기다림으로 바뀌고 닫으면 없어진다
        List<Boolean> structural = new ArrayList<>();
        ActivityLog log = new ActivityLog("analysis", structural::add);
        Map<String, Object> part = new HashMap<>(); part.put("part", 1); part.put("total", 2); part.put("bytes", 4299161);
        log.open("sendTranscript", part, 4299161L);
        Map<String, Object> open = (Map<String, Object>) parse(log.json()).get("open");
        expect("upload".equals(open.get("phase")) && ((Number) open.get("sent")).longValue() == 0 && open.get("waitSince") == null, "올리기 단계로 시작");
        expect("전사 · 조각 1/2".equals(open.get("label")) && ((Number) open.get("size")).longValue() == 4299161L, "요청 이름과 크기");
        log.progress(2202010);
        expect(((Number) ((Map<String, Object>) parse(log.json()).get("open")).get("sent")).longValue() == 2202010, "올린 양 반영");
        log.uploaded();
        open = (Map<String, Object>) parse(log.json()).get("open");
        expect("wait".equals(open.get("phase")) && open.get("waitSince") != null, "다 올리면 기다림 단계");
        log.close();
        expect(parse(log.json()).get("open") == null, "닫으면 열린 요청 없음");
        Map<String, Object> section = new HashMap<>(); section.put("part", "2-1"); section.put("total", 2);
        log.open("sendSummary", section, null);
        open = (Map<String, Object>) parse(log.json()).get("open");
        expect("wait".equals(open.get("phase")) && open.get("waitSince") != null && open.get("size") == null, "크기 없는 요청은 처음부터 기다림");
        double since = ((Number) open.get("since")).doubleValue();
        Thread.sleep(5);
        log.uploaded();
        expect(((Number) ((Map<String, Object>) parse(log.json()).get("open")).get("waitSince")).doubleValue() >= since, "다 올린 시각으로 기다림 기준을 다시 정함");
        // 바이트 진행은 구조 변경이 아니다
        structural.clear();
        log.progress(10); log.add("recvSummary", section); log.uploaded(); log.close(); log.attach("main", "m1", null);
        expect(structural.equals(Arrays.asList(false, true, true, true, true)), "구조 변경 표시 " + structural);
        // 회의를 나중에 붙여도 앞 줄이 남는다
        ActivityLog importing = new ActivityLog("analysis", null);
        Map<String, Object> split = new HashMap<>(); split.put("total", 3);
        importing.add("splitImport", split);
        importing.attach("main", "meeting-1", null);
        Map<String, Object> snapshot = parse(importing.json());
        expect("main".equals(snapshot.get("location")) && "meeting-1".equals(snapshot.get("meetingId")) && snapshot.get("resultId") == null, "회의 붙이기");
        expect("녹음 파일 나눔 · 3개".equals(((Map<String, Object>) ((List<Object>) snapshot.get("entries")).get(0)).get("text")), "붙이기 전 줄이 남음");
        expect("analysis".equals(snapshot.get("kind")) && snapshot.get("id") instanceof String, "일지 번호와 종류");
        // 마지막 줄이 실패·취소면 lastIsFailure가 참이다
        ActivityLog failing = new ActivityLog("analysis", null);
        expect(!failing.lastIsFailure(), "빈 일지는 실패 아님");
        failing.add("recvSummary", section);
        expect(!failing.lastIsFailure(), "받음은 실패 아님");
        failing.add("timeout", null);
        expect(failing.lastIsFailure(), "시간 초과는 실패");
        // failOnce는 일지가 없어도 예외 없이 지나가고 실패 줄을 한 번만 더한다
        ActivityLog.failOnce(null, "x");
        ActivityLog once = new ActivityLog("analysis", null);
        ActivityLog.failOnce(once, "AI 요청에 실패했습니다. HTTP 500");
        ActivityLog.failOnce(once, "AI 요청에 실패했습니다. HTTP 500");
        expect(once.entries().size() == 1 && once.entries().get(0).text.equals("실패 · AI 요청에 실패했습니다"), "실패 줄은 한 번");
        System.out.println("PASS " + checks + " ActivityLog checks");
    }
}
