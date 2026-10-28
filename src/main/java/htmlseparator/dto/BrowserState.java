package htmlseparator.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class BrowserState {
    private String current_page_html;
    private String current_url;

    /** Компактный снимок страницы из расширения (title, text, elements[...]). Сервер его не разбирает — просто хранит и отдаёт. */
    private Map<String, Object> snapshot;

    /** false — не дождались свежего состояния после команды (расширение не ответило за таймаут). */
    private Boolean fresh;
}