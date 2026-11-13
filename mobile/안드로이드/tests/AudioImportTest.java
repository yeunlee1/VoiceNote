// 휴대폰 녹음 파일 불러오기의 판정 규칙(m4a 머리, 나눌지, 조각 경계, 공간, 이름, 안내 문구)을 기기 없이 검증한다.
package kr.local.meetingjournal;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
public final class AudioImportTest {
    static int checks;
    static void expect(boolean value,String label){if(!value)throw new AssertionError(label);checks++;}
    static byte[] bytes(int... values){byte[] out=new byte[values.length];for(int i=0;i<values.length;i++)out[i]=(byte)values[i];return out;}
    static byte[] join(Object... parts){ByteArrayOutputStream out=new ByteArrayOutputStream();for(Object part:parts){byte[] b=part instanceof String?((String)part).getBytes(StandardCharsets.US_ASCII):(byte[])part;out.write(b,0,b.length);}return out.toByteArray();}
    public static void main(String[] args){
        byte[] m4a=join(bytes(0,0,0,0x18),"ftypM4A ",bytes(0,0,0,0),"M4A isom");
        expect(AudioImport.mp4Header(m4a),"첫 상자가 ftyp인 m4a 머리는 받는다");
        expect(!AudioImport.mp4Header(Arrays.copyOf(m4a,8)),"ftyp까지만 있는 8바이트는 받지 않는다");
        expect(!AudioImport.mp4Header(new byte[0]),"빈 파일은 받지 않는다");
        expect(!AudioImport.mp4Header(join("RIFF",bytes(4,0,0,0),"WAVE")),"wav는 받지 않는다");
        expect(!AudioImport.mp4Header(bytes(0x1a,0x45,0xdf,0xa3,0x9f,0x42,0x86,0x81,0x01,0x42,0xf7,0x81)),"webm은 받지 않는다");
        expect(!AudioImport.needsSplit(1_200_000_000L,23_068_672L),"정확히 20분·22MB는 그대로 담는다");
        expect(AudioImport.needsSplit(1_200_000_001L,1),"20분을 넘으면 나눈다");
        expect(AudioImport.needsSplit(1,23_068_673L),"22MB를 넘으면 나눈다");
        long maxUs=AudioImport.PART_MAX_US,maxBytes=AudioImport.PART_TARGET_BYTES;
        expect(!AudioImport.newPart(0,5_000_000_000L,0,30_000_000,maxUs,maxBytes),"아직 빈 조각은 길이·크기와 관계없이 새 조각을 시작하지 않는다");
        expect(AudioImport.newPart(0,1_200_000_000L,10,10,maxUs,maxBytes),"조각이 20분에 닿으면 새 조각을 시작한다");
        expect(!AudioImport.newPart(0,1_199_999_999L,20_971_510L,10,maxUs,maxBytes),"20분 안이고 20MiB를 넘지 않으면 같은 조각이다");
        expect(AudioImport.newPart(0,5,20_971_511L,10,maxUs,maxBytes),"20MiB를 넘으면 새 조각을 시작한다");
        expect(AudioImport.enoughSpace(52_428_800L+100,100),"파일 크기와 여유 50MiB가 있으면 공간이 충분하다");
        expect(!AudioImport.enoughSpace(52_428_800L+99,100),"1바이트라도 모자라면 공간이 부족하다");
        expect(AudioImport.FILE_MAX_US==14_400_000_000L,"4시간 상한");
        for(String blank:new String[]{null,"","  "})expect("고른 파일".equals(AudioImport.label(blank)),"이름을 모르면 고른 파일이라고 부른다");
        expect("통화.m4a".equals(AudioImport.label(" 통화.m4a ")),"이름 앞뒤 공백을 뺀다");
        expect("‘통화.m4a’ 파일은 불러올 수 없습니다. m4a 녹음 파일만 불러올 수 있습니다.".equals(AudioImport.unsupported("통화.m4a")),"형식 안내");
        expect("‘고른 파일’ 파일은 불러올 수 없습니다. m4a 녹음 파일만 불러올 수 있습니다.".equals(AudioImport.unsupported(null)),"이름 없는 형식 안내");
        expect("‘통화.m4a’ 파일은 20분(22MB)이 넘는데 나눌 수 없는 형식입니다. 20분 이하 파일만 불러올 수 있습니다.".equals(AudioImport.unsplittable("통화.m4a")),"나눌 수 없는 형식 안내");
        expect("‘고른 파일’ 파일은 20분(22MB)이 넘는데 나눌 수 없는 형식입니다. 20분 이하 파일만 불러올 수 있습니다.".equals(AudioImport.unsplittable(null)),"이름 없는 나눌 수 없는 형식 안내");
        expect("‘통화.m4a’ 파일은 4시간이 넘어 불러올 수 없습니다.".equals(AudioImport.tooLong("통화.m4a")),"4시간 안내");
        expect("‘고른 파일’ 파일은 4시간이 넘어 불러올 수 없습니다.".equals(AudioImport.tooLong("")),"이름 없는 4시간 안내");
        expect("휴대폰 저장 공간이 부족해 파일을 불러오지 못했습니다.".equals(AudioImport.NO_SPACE),"공간 부족 안내");
        expect("파일을 읽지 못했습니다. 다시 골라 주세요.".equals(AudioImport.UNREADABLE),"읽기 실패 안내");
        expect("audio/mp4a-latm".equals(AudioImport.AAC),"자를 수 있는 형식은 AAC");
        System.out.println("불러오기 규칙 "+checks+"개 통과");
    }
}
