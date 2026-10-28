#!/bin/sh
# push 비밀 검사 훅을 임시 저장소와 임시 원격으로 시험한다. 실제 키 대신 임시 키 파일(VOICENOTE_KEY_FILES)을 쓰고 키 값은 출력하지 않는다. 실행: sh .githooks/push-비밀검사-시험.sh
set -u
H=$(cd "$(dirname "$0")" && pwd); S=$(mktemp -d)
W="$S/훅시험-작업"
rm -rf "$W"; mkdir -p "$W"
git init -q --bare "$W/원격.git"; git init -q --bare "$W/다른원격.git"
git init -q "$W/저장소"
cd "$W/저장소"
git config user.name t; git config user.email t@t; git config core.autocrlf false; git checkout -q -b main
mkdir -p .git/hooks
cp "$H/pre-push" "$H/push-비밀검사.cjs" .git/hooks/
git remote add origin "$W/원격.git"; git remote add 다른곳 "$W/다른원격.git"
FAKE_REAL="sk-proj-$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))")"
SHAPE="sk-$(node -e "process.stdout.write(require('crypto').randomBytes(20).toString('hex'))")"
printf '{"apiKey":"%s"}' "$FAKE_REAL" > "$W/임시키.json"
export VOICENOTE_KEY_FILES="$W/임시키.json" FAKE_REAL SHAPE
show() { if grep -q "$FAKE_REAL" "$W/out.txt" || grep -q "$SHAPE" "$W/out.txt"; then echo "실패 $1: 키 값이 출력에 보임"; fi; }
judge() { name="$1"; expect="$2"; code="$3"; if [ "$expect" = 막음 ] && [ $code -ne 0 ] && grep -q "push를 멈췄습니다" "$W/out.txt"; then echo "통과 $name"; elif [ "$expect" = 허용 ] && [ $code -eq 0 ]; then echo "통과 $name"; else echo "실패 $name (종료 $code)"; cat "$W/out.txt"; fi; show "$name"; }
try() { git push -q -f origin HEAD:main > "$W/out.txt" 2>&1; judge "$1" "$2" $?; }
undo() { git reset -q --hard HEAD~1; }
echo "평범한 내용" > a.txt; git add a.txt; git commit -q -m "첫 커밋"; try "평범한 첫 push" 허용
echo "test key: sk-test-SECRET-never-shown-1234567890" > b.txt; git add b.txt; git commit -q -m "가짜 시험 키"; try "공개된 가짜 시험 키는 허용" 허용
echo "const key = '$FAKE_REAL';" > c.txt; git add c.txt; git commit -q -m "실제 키"; try "이 PC의 실제 키 값을 막음" 막음; undo
echo "key=$SHAPE" > d.txt; git add d.txt; git commit -q -m "키 모양"; try "모르는 키 모양 문자열을 막음" 막음; undo
echo '{}' > .env.회의록키; git add -f .env.회의록키; git commit -q -m "키 파일"; try "키 파일 이름을 막음" 막음; undo
node -e "require('fs').writeFileSync('그림.bin', Buffer.concat([Buffer.from([0,1,2,0,255]), Buffer.from(process.env.FAKE_REAL), Buffer.from([0,0,9])]))"; git add 그림.bin; git commit -q -m "바이너리"; try "바이너리 안의 실제 키를 막음" 막음; undo
node -e "require('fs').writeFileSync('설정16.json', Buffer.concat([Buffer.from([0xff,0xfe]), Buffer.from(JSON.stringify({apiKey:process.env.SHAPE}),'utf16le')]))"; git add 설정16.json; git commit -q -m "UTF-16"; try "UTF-16 JSON 안의 키 모양을 막음" 막음; undo
echo "평범" > "$SHAPE.txt"; git add "$SHAPE.txt"; git commit -q -m "이름에 키"; try "파일 이름 안의 키 모양을 막음" 막음; undo
echo "평범" > "$SHAPE.pem"; git add -f "$SHAPE.pem"; git commit -q -m "막는 종류 이름에 키"; try "막는 종류 파일 이름의 키도 안내에 가림" 막음; undo
echo "$FAKE_REAL" > "$FAKE_REAL.txt"; git add "$FAKE_REAL.txt"; git commit -q -m "이름과 내용에 실제 키"; try "이름과 내용에 실제 키가 있어도 안내에 가림" 막음; undo
echo "평범한 변경" >> a.txt; git add a.txt; git commit -q -m "메모 $FAKE_REAL"; try "커밋 메시지 안의 실제 키를 막음" 막음; undo
node -e "require('fs').writeFileSync('묶음.zip', Buffer.from('PK\u0003\u0004 압축'))"; git add -f 묶음.zip; git commit -q -m "압축 파일"; try "속을 읽을 수 없는 압축 파일을 막음" 막음; undo
git checkout -q -b 새가지; echo "$FAKE_REAL" > e.txt; git add e.txt; git commit -q -m "새 가지의 실제 키"; git push -q -f origin 새가지 > "$W/out.txt" 2>&1; judge "새 브랜치 첫 push도 검사" 막음 $?
git update-ref refs/remotes/다른곳/새가지 HEAD; git push -q -f origin 새가지 > "$W/out.txt" 2>&1; judge "다른 원격에만 있는 커밋도 검사" 막음 $?
git tag -a 표시 -m "태그 메모 $SHAPE" main; git push -q origin 표시 > "$W/out.txt" 2>&1; judge "태그 메시지 안의 키 모양을 막음" 막음 $?
git checkout -q main; echo "둘째 평범" > f.txt; git add f.txt; git commit -q -m "둘째"; try "평범한 이어 push는 허용" 허용
cd /; rm -rf "$S"
