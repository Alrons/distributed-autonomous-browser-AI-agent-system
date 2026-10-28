package htmlseparator.service;

import htmlseparator.dto.BrowserState;
import org.springframework.stereotype.Service;

@Service
public class BrowserStateServiceImpl implements BrowserStateService {

    private volatile BrowserState currentState;
    private volatile boolean isModify = false;

    private final HhParserService hhParserService;

    public BrowserStateServiceImpl(HhParserService hhParserService) {
        this.hhParserService = hhParserService;
    }

    @Override
    public Boolean isModified() {
        return isModify;
    }

    @Override
    public BrowserState getBrowserState() {
        isModify = false;
        return currentState;
    }

    @Override
    public Boolean modifyState(BrowserState rawState) {
        if (rawState == null) {
            return false;
        }

        String html = rawState.getCurrent_page_html();
        String cleanedHtml = (html == null || html.isBlank())
                ? ""
                : hhParserService.processRawHtml(html).getSortedHTML();

        this.currentState = new BrowserState(cleanedHtml, rawState.getCurrent_url(), rawState.getSnapshot(), true);
        this.isModify = true;

        return true;
    }
}