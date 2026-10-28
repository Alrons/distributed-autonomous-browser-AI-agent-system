package htmlseparator.dto.Responce;


import com.fasterxml.jackson.annotation.JsonProperty;
import htmlseparator.dto.InputData;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class ActionResponce {

    @JsonProperty("url_to_open")
    private String urlToOpen;

    @JsonProperty("click_selector")
    private String clickSelector;

    @JsonProperty("inputs_to_fill")
    private List<InputData> inputsToFill;
}