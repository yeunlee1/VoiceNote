// 다른 앱이 만든 녹음 파일을 불러올 때의 판정 규칙(m4a 머리, 나눌지, 조각 경계, 공간)과 안내 문구를 둔다.
package kr.local.meetingjournal;
import java.nio.charset.StandardCharsets;

final class AudioImport {
    static final long COPY_MAX_US=1_200_000_000L,COPY_MAX_BYTES=23_068_672L;
    // 앱 녹음(MeetingService)과 같은 기준이다. 둘 다 안이면 원본을 그대로 담고, 넘으면 다시 압축하지 않고 잘라 담는다.
    static final long PART_MAX_US=1_200_000_000L,PART_TARGET_BYTES=20_971_520L;
    // 조각은 20분이나 22MB 상한 아래 여유를 둔 20MiB 중 먼저 닿는 곳에서 끊는다.
    static final long FILE_MAX_US=14_400_000_000L,SPACE_MARGIN_BYTES=52_428_800L;
    // 녹음 서비스의 화면 꺼짐 방지가 4시간이라 그보다 긴 파일은 받지 않는다. 담을 공간은 파일 크기에 50MiB 여유를 더해 본다.
    static final String AAC="audio/mp4a-latm";
    static final String NO_SPACE="휴대폰 저장 공간이 부족해 파일을 불러오지 못했습니다.";
    static final String UNREADABLE="파일을 읽지 못했습니다. 다시 골라 주세요.";

    private AudioImport(){}
    static boolean mp4Header(byte[] head){
        return head!=null&&head.length>=12&&"ftyp".equals(new String(head,4,4,StandardCharsets.US_ASCII));
        // MP4 계열은 첫 상자가 ftyp다. Windows 불러오기와 서버 전사 판정도 같은 조건을 본다.
    }
    static boolean needsSplit(long durationUs,long sizeBytes){return durationUs>COPY_MAX_US||sizeBytes>COPY_MAX_BYTES;}
    static boolean newPart(long partStartUs,long sampleUs,long partBytes,int sampleBytes,long maxUs,long maxBytes){
        return partBytes>0&&(sampleUs-partStartUs>=maxUs||partBytes+sampleBytes>maxBytes);
        // 아직 샘플이 없는 조각은 길이·크기와 관계없이 이 샘플부터 채운다. 샘플 하나가 상한보다 커도 빈 조각을 만들지 않는다.
    }
    static boolean enoughSpace(long usableBytes,long sizeBytes){return usableBytes>=sizeBytes+SPACE_MARGIN_BYTES;}
    static String label(String displayName){
        String name=displayName==null?"":displayName.trim();
        return name.isEmpty()?"고른 파일":name;
        // 이름을 주지 않는 문서 제공자도 있어 그때는 고른 파일이라고 부른다.
    }
    static String unsupported(String name){return "‘"+label(name)+"’ 파일은 불러올 수 없습니다. m4a 녹음 파일만 불러올 수 있습니다.";}
    static String unsplittable(String name){return "‘"+label(name)+"’ 파일은 20분(22MB)이 넘는데 나눌 수 없는 형식입니다. 20분 이하 파일만 불러올 수 있습니다.";}
    static String tooLong(String name){return "‘"+label(name)+"’ 파일은 4시간이 넘어 불러올 수 없습니다.";}
}
