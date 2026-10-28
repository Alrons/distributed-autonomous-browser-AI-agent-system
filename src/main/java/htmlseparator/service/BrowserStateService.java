package htmlseparator.service;

import htmlseparator.dto.BrowserState;

public interface BrowserStateService {

    public Boolean isModified();

    public BrowserState getBrowserState ();

    public Boolean modifyState(BrowserState state);
}
