package htmlseparator.service;

import htmlseparator.dto.Responce.ActionResponce;

public interface ActionService {

    /** Отдаёт расширению команду (один раз). Если команды нет — пустую. */
    ActionResponce getAction();

    /** n8n кладёт новую команду. Пустые команды (ничего делать не нужно) игнорируются. */
    ActionResponce modifyState(ActionResponce action);

    /** Расширение прислало состояние страницы — значит, ранее выданная команда уже выполнена. */
    void onStateReceived();

    /** true, пока команда ещё не выдана расширению или после выдачи ещё не пришло состояние страницы. */
    boolean isBusy();
}