package htmlseparator.service;

import htmlseparator.dto.Responce.CleanedPageResponce;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Attribute;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import org.springframework.stereotype.Service;

import java.util.Arrays;
import java.util.List;


@Service
public class HhParserServiceImpl implements HhParserService {

    private  BrowserStateService browserState;



    private static final List<String> USEFUL_ATTRIBUTES = Arrays.asList(
            "href", "id", "name", "type", "value", "placeholder",
            "data-qa", "data-testid", "data-id", "aria-label", "title"
    );

    public CleanedPageResponce processRawHtml(String rawHtml) {
        String noCommentsHtml = rawHtml.replaceAll("<!--[\\s\\S]*?-->", "");

        Document doc = Jsoup.parse(rawHtml);

        doc.outputSettings().prettyPrint(false);

        doc.select("header, footer, nav, aside, script, style, svg, path, noscript, meta, link, img, br, hr, template, noindex").remove();

        Elements elements = doc.getAllElements();

        for (Element el : elements) {
            String tag = el.tagName();

            // Пропускаем фундамент страницы
            if (tag.equals("html") || tag.equals("head") || tag.equals("body") || tag.equals("#root")) {
                continue;
            }

            if (el.text().trim().length() < 3 && el.children().isEmpty()) {
                el.remove();
                continue;
            }

            if (tag.equals("a") || tag.equals("button") || tag.equals("input") || tag.equals("textarea") || tag.equals("select")) {
                for (Attribute attr : el.attributes().asList()) {
                    if (!USEFUL_ATTRIBUTES.contains(attr.getKey().toLowerCase())) {
                        el.removeAttr(attr.getKey());
                    }
                }
                continue;
            }

            el.clearAttributes();
        }


        boolean changed = true;
        while (changed) {
            changed = false;
            for (Element el : doc.select("div, span")) {
                if (el.childrenSize() == 1 && el.ownText().trim().isEmpty()) {
                    el.unwrap(); // Распаковываем
                    changed = true; // Запускаем цикл заново, так как структура изменилась
                }
            }
        }

        String finalHtml = doc.body().html().replaceAll("\\s*\\n\\s*", " ").trim();

        return new CleanedPageResponce(doc.body().html());
    }

}
