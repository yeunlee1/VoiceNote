// 할 일 수정본의 참석자 나누기·이름순·의견 반영 이어 주기 규칙을 데스크톱 할일정리.js와 같게 둔다. 안드로이드 라이브러리 없이 PC에서도 시험한다.
package kr.local.meetingjournal;

import java.util.*;

final class Todos {
    static final int MAX_PEOPLE=20,MAX_TASK=2000,MAX_FIELD=200;
    static final class Item {
        final String task,owner,due;final boolean done;
        Item(String task,String owner,String due,boolean done){this.task=task;this.owner=owner;this.due=due;this.done=done;}
    }
    static final class Carried {
        final boolean finalized;final List<Item> items;
        Carried(boolean finalized,List<Item> items){this.finalized=finalized;this.items=items;}
    }
    private static final String SPACE="[\\s\\u00A0\\uFEFF\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]+";
    private Todos(){}
    private static String same(String text){return text==null?"":JsonText.trim(text).replaceAll(SPACE," ");}
    // AI가 빈 글자나 공백 붙은 이름을 주어도 저장본과 같은 기준으로 비교한다.
    private static String field(String value){if(value==null)return null;String text=JsonText.trim(value);return text.isEmpty()?null:text;}
    private static boolean hasOwner(Item item){return !same(item.owner).isEmpty();}
    private static boolean equal(String a,String b){return Objects.equals(a,b);}
    // 참석자 칸은 자유 입력이라 쉼표·줄바꿈으로만 나눈다. '김민수 팀장'처럼 공백이 든 이름은 한 사람이다.
    static List<String> people(String text){
        List<String> names=new ArrayList<>();if(text==null)return names;
        for(String piece:text.split("[,，、;；\\r\\n]+")){
            String name=JsonText.trim(piece);
            if(name.isEmpty()||name.length()>MAX_FIELD||names.contains(name))continue;
            names.add(name);if(names.size()==MAX_PEOPLE)break;
        }
        return names;
    }
    // 같은 이름끼리는 원래 순서를 지키고 담당자가 없는 일은 맨 뒤에 둔다. 원본 목록은 바꾸지 않고 순서만 돌려준다.
    // 한글은 글자 코드 순서가 곧 가나다순이다. 언어별 정렬은 기기마다 공백을 다르게 다뤄 쓰지 않는다.
    static int[] sortedOrder(List<Item> items){
        List<Integer> order=new ArrayList<>();for(int i=0;i<items.size();i++)order.add(i);
        order.sort((a,b)->{Item left=items.get(a),right=items.get(b);boolean l=hasOwner(left),r=hasOwner(right);if(l!=r)return l?-1:1;int by=l?same(left.owner).compareTo(same(right.owner)):0;return by!=0?by:a-b;});
        int[] result=new int[order.size()];for(int i=0;i<result.length;i++)result[i]=order.get(i);return result;
    }
    // 체크만 한 회의록은 AI 순서를 두고, 사람이 담당자를 맞췄거나 맞추기를 끝낸 회의록만 이름순으로 정리한다.
    static int[] outputOrder(boolean finalized,List<Item> items,List<Item> ai){
        boolean assigned=finalized;for(int i=0;!assigned&&i<items.size();i++)assigned=!equal(field(items.get(i).owner),field(ai.get(i).owner));
        if(assigned)return sortedOrder(items);
        int[] order=new int[items.size()];for(int i=0;i<order.length;i++)order[i]=i;return order;
    }
    static Carried carryOver(List<Item> previousAi,boolean finalized,List<Item> edits,List<Item> next){
        if(edits.size()!=previousAi.size())return null;
        List<Item> freshItems=new ArrayList<>();for(Item item:next)freshItems.add(new Item(item.task,field(item.owner),field(item.due),false));
        // 새 일마다 이어 줄 이전 일을 찾는다. 사람이 고친 문장과 AI의 원래 문장 중 어느 쪽이 같아도 같은 일로 본다.
        List<List<Integer>> candidates=new ArrayList<>();int[] uses=new int[edits.size()];
        for(Item fresh:freshItems){
            List<Integer> found=new ArrayList<>();String text=same(fresh.task);
            for(int i=0;i<edits.size();i++)if(same(edits.get(i).task).equals(text)||same(previousAi.get(i).task).equals(text)){found.add(i);uses[i]++;}
            candidates.add(found);
        }
        boolean carried=false;List<Item> items=new ArrayList<>();
        for(int at=0;at<freshItems.size();at++){
            Item fresh=freshItems.get(at);List<Integer> found=candidates.get(at);
            // 일대일로 맞지 않으면 어느 일인지 확실하지 않으므로 잇지 않는다.
            if(found.size()!=1||uses[found.get(0)]!=1){items.add(fresh);continue;}
            Item item=edits.get(found.get(0)),ai=previousAi.get(found.get(0));
            // 사람이 고친 값만 잇고, 사람이 손대지 않은 값은 의견을 반영한 AI의 새 값을 따른다.
            String task=!same(item.task).equals(same(ai.task))?item.task:fresh.task,owner=!equal(field(item.owner),field(ai.owner))?field(item.owner):fresh.owner,due=!equal(field(item.due),field(ai.due))?field(item.due):fresh.due;
            // AI가 담당이나 기한을 바꿨으면 새로운 일일 수 있어 끝났다는 표시는 잇지 않는다.
            boolean done=item.done&&equal(field(ai.owner),fresh.owner)&&equal(field(ai.due),fresh.due);
            if(done||!task.equals(fresh.task)||!equal(owner,fresh.owner)||!equal(due,fresh.due))carried=true;
            items.add(new Item(task,owner,due,done));
        }
        return carried?new Carried(finalized,items):null;
    }
}
