// 사본 파일의 이름 제한·겹침 방지·중간 실패 정리를 순수 파일 시스템으로 검증한다.
package kr.local.meetingjournal;
import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;

public final class CopyFilesTest {
    static int checks;
    static void expect(boolean value,String label){if(!value)throw new AssertionError(label);checks++;}
    static Copies.Created write(Copies.FileSink sink,String folder,String name,InputStream input)throws Exception{
        return sink.write(folder,name,"text/plain",()->input);
    }
    static String title(String text){return Copies.safeTitle(text);}
    public static void main(String[] args)throws Exception{
        Copies.FileSink sink=new Copies.FileSink();Path dir=Files.createTempDirectory("vn-copies-");
        try{
            Path foreign=dir.resolve("같은 이름.txt");Files.writeString(foreign,"남의 기록");
            Copies.Created saved=write(sink,dir.toUri().toString(),"같은 이름.txt",new ByteArrayInputStream("새 사본".getBytes(StandardCharsets.UTF_8)));
            expect(saved.name.equals("같은 이름 (2).txt"),"같은 이름이면 (2)를 붙인다");
            expect(Files.readString(foreign).equals("남의 기록"),"남의 파일을 덮어쓰지 않는다");
            expect(Files.readString(Paths.get(URI.create(saved.uri))).equals("새 사본"),"돌려준 실제 URI로 사본을 연다");
            expect(sink.exists(saved.uri),"쓴 문서 URI를 다시 열 수 있다");
            long before;try(java.util.stream.Stream<Path> files=Files.list(dir)){before=files.count();}
            InputStream broken=new InputStream(){int n;public int read()throws IOException{if(n++<3)return 'x';throw new IOException("합성 읽기 실패");}};
            try{write(sink,dir.toUri().toString(),"실패.txt",broken);throw new AssertionError("중간 쓰기 실패가 필요하다");}catch(IOException expected){}
            try(java.util.stream.Stream<Path> files=Files.list(dir)){expect(files.count()==before,"중간 실패 뒤 반쪽 파일과 임시 파일이 없다");}
            try{write(sink,dir.resolve("없음").toUri().toString(),"불가.txt",new ByteArrayInputStream(new byte[0]));throw new AssertionError("없는 폴더를 거절한다");}catch(IOException expected){expect(true,"없는 폴더에 임의로 새 폴더를 만들지 않는다");}
            try{write(sink,dir.toUri().toString(),"../바깥.txt",new ByteArrayInputStream(new byte[0]));throw new AssertionError("경로를 거절한다");}catch(IOException expected){expect(true,"파일 이름에 경로를 넣지 못한다");}
            try{write(sink,dir.toUri().toString(),"A\nB\nC.txt",new ByteArrayInputStream(new byte[0]));throw new AssertionError("여러 제어 문자를 거절한다");}catch(IOException expected){expect(true,"여러 줄바꿈이 든 파일 이름을 거절한다");}
            expect(title("기획/회의").equals("기획_회의"),"금지 문자를 밑줄로 바꾼다");
            expect(title(" . ").equals("회의"),"빈 제목은 기본 이름을 쓴다");
            for(String value:new String[]{"가".repeat(300),"😀".repeat(300),"a".repeat(300)}){
                String safe=title(value);expect(safe.getBytes(StandardCharsets.UTF_8).length<=120&&safe.codePointCount(0,safe.length())<=80,"긴 제목도 파일 시스템 길이 안에 든다");
                expect(StandardCharsets.UTF_8.newEncoder().canEncode(safe),"이모지를 반쪽으로 자르지 않는다");
            }
            System.out.println("사본 파일 "+checks+"개 검증 통과");
        }finally{try(java.util.stream.Stream<Path> files=Files.walk(dir)){files.sorted(java.util.Comparator.reverseOrder()).forEach(p->{try{Files.delete(p);}catch(IOException ex){throw new java.io.UncheckedIOException(ex);}});}}
    }
}
