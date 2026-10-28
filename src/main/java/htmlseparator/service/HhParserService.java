package htmlseparator.service;

import htmlseparator.dto.Responce.CleanedPageResponce;

public interface HhParserService {

    public CleanedPageResponce processRawHtml (String rawHtml);
}
