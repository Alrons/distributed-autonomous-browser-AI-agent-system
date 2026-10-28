package htmlseparator.controllers;


import htmlseparator.dto.BrowserState;
import htmlseparator.dto.Responce.ActionResponce;
import htmlseparator.service.ActionService;
import htmlseparator.service.BrowserStateService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
public class ActionController {

    private final BrowserStateService browserStateService;
    private final ActionService Action;


    @PostMapping("/sync")
    public ActionResponce syncBrowser(@RequestBody BrowserState state) {
        browserStateService.modifyState(state);
        Action.onStateReceived();
        return Action.getAction();
    }

    @PostMapping("/change")
    public ActionResponce changeAction(@RequestBody ActionResponce ActionRequest){
        return Action.modifyState(ActionRequest);
    }
}
