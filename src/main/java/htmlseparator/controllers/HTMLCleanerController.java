package htmlseparator.controllers;

import htmlseparator.dto.BrowserState;
import htmlseparator.service.ActionService;
import htmlseparator.service.BrowserStateService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class HTMLCleanerController {

    private final BrowserStateService cleaner;
    private final ActionService actionService;

    @GetMapping()
    public ResponseEntity<BrowserState> getCleanedHTML() {
        return ResponseEntity.ok(cleaner.getBrowserState());
    }

    @GetMapping("/state")
    public ResponseEntity<BrowserState> getState(
            @RequestParam(defaultValue = "false") boolean wait,
            @RequestParam(defaultValue = "30000") long timeoutMs) throws InterruptedException {

        boolean fresh = true;
        if (wait) {
            long deadline = System.currentTimeMillis() + timeoutMs;
            while (actionService.isBusy()) {
                if (System.currentTimeMillis() > deadline) {
                    fresh = false;
                    break;
                }
                Thread.sleep(150);
            }
        }

        BrowserState s = cleaner.getBrowserState();
        if (s == null) {
            // расширение ещё ни разу не присылало страницу
            return ResponseEntity.ok(new BrowserState("", "", null, fresh));
        }
        return ResponseEntity.ok(new BrowserState(s.getCurrent_page_html(), s.getCurrent_url(), s.getSnapshot(), fresh));
    }
}