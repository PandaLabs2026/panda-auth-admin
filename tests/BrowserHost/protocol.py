from pathlib import Path
import json
import sys
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
if len(sys.argv) != 3:
 raise SystemExit('Usage: protocol.py METADATA_PATH OUTPUT_DIRECTORY')
root=Path(sys.argv[2]).resolve()
root.mkdir(parents=True,exist_ok=True)
meta=json.loads(Path(sys.argv[1]).read_text())
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 ctx=browser.new_context(ignore_https_errors=True,locale='zh-CN')
 baseline=ctx.request.get(meta['issuer']+'fixture/evidence').json()['exchanges']
 page=ctx.new_page();trace=[];page.on('response',lambda r:trace.append({'path':urlsplit(r.url).path,'status':r.status}));errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(meta['origin']+'/admin/users?page=2')
 try:page.get_by_text('Browser Admin',exact=True).first.wait_for(timeout=20000)
 except Exception:
  page.screenshot(path=str(root/'protocol-failure.png'),full_page=True)
  print(json.dumps({'path':urlsplit(page.url).path,'body':page.locator('body').inner_text()[:1000],'errors':errors,'trace':trace,'evidence':ctx.request.get(meta['issuer']+'fixture/evidence').json()},ensure_ascii=False));raise
 assert urlsplit(page.url).path=='/admin/users'
 evidence=ctx.request.get(meta['issuer']+'fixture/evidence').json()
 assert evidence['exchanges']==baseline+1 and evidence['pkceVerified'] is True
 page.screenshot(path=str(root/'protocol-login.png'),full_page=True)
 page.reload();page.get_by_text('Browser Admin',exact=True).first.wait_for(timeout=10000)
 assert ctx.request.get(meta['origin']+'/admin/api/session').status==200
 page.get_by_text('Browser Admin',exact=True).first.click()
 page.get_by_role('menuitem',name='退出登录').click()
 page.get_by_role('heading',name='退出状态').wait_for(timeout=15000)
 assert page.get_by_text('本应用的本地会话已清除。',exact=True).is_visible()
 assert ctx.request.get(meta['origin']+'/admin/api/session').status==401
 evidence=ctx.request.get(meta['issuer']+'fixture/evidence').json()
 assert evidence['logoutSeen'] is True and evidence['exchanges']==baseline+1
 page.screenshot(path=str(root/'protocol-logout.png'),full_page=True)
 assert errors == [], errors
 result={'login':True,'refresh':True,'nativeLogout':True,'postLogoutSession':401,'evidence':evidence,'errors':errors}
 (root/'protocol-results.json').write_text(json.dumps(result,indent=2))
 print(json.dumps(result))
 ctx.close();browser.close()
