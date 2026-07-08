# V5 Performance Test Checklist

## Pagination

- Open page 1.
- Click Trang sau 5 times.
- DOM card count must not grow cumulatively.
- Click Trang trước.
- Search text must reset to page 1.
- Change usage_side/view_mode filter; page resets to 1.
- Fast search typing must not let old response overwrite new response.

## Images

Network panel:
- offscreen images should not all load immediately;
- card images decode async;
- media responses should include cache headers;
- second visit should show browser/cache reuse where applicable.

## Mobile

Test:
- iPhone Safari
- Android Chrome
- installed APK/WebView if used

Observe:
- memory;
- scroll FPS;
- image decode jank;
- tab crash.

## Regression

Must still work:
- auth/session restore
- exact search
- filters
- open detail
- edit
- upload
- R2 media
- Thư ký Kim Top 5
