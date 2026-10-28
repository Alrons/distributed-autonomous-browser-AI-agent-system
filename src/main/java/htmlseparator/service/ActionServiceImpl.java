package htmlseparator.service;

import htmlseparator.dto.Responce.ActionResponce;
import org.springframework.stereotype.Service;

import java.util.Collections;

@Service
public class ActionServiceImpl implements ActionService { // только для одного пользователя

    private volatile ActionResponce lastState;

    /** Команда принята от n8n, но расширение её ещё не забрало. */
    private volatile boolean hasPending = false;

    /** Команда выдана расширению, но состояние страницы ПОСЛЕ её выполнения ещё не пришло. */
    private volatile boolean awaitingPostState = false;

    @Override
    public ActionResponce getAction() {
        if (hasPending) {
            hasPending = false;
            awaitingPostState = true;
            return lastState;
        }
        return new ActionResponce("", "", Collections.emptyList());
    }

    @Override
    public ActionResponce modifyState(ActionResponce action) {
        lastState = action;
        if (!isEmpty(action)) {
            hasPending = true;
        }
        return action;
    }

    @Override
    public void onStateReceived() {
        awaitingPostState = false;
    }

    @Override
    public boolean isBusy() {
        return hasPending || awaitingPostState;
    }

    private static boolean isEmpty(ActionResponce a) {
        if (a == null) return true;
        boolean noUrl = a.getUrlToOpen() == null || a.getUrlToOpen().isBlank();
        boolean noClick = a.getClickSelector() == null || a.getClickSelector().isBlank();
        boolean noInputs = a.getInputsToFill() == null || a.getInputsToFill().isEmpty();
        return noUrl && noClick && noInputs;
    }
}