package com.repograph.taint.api;

import java.util.ArrayList;
import java.util.List;
import java.util.StringJoiner;


/**
 * Represents the configuration settings for a check operation within the system.
 * This class provides various parameters to control the behavior of the check process.
 */
public class CheckConfig {

	/**
	 * The precision level for the check operation. Default is 1.
	 */
	private Integer precision = 1;

	/**
	 * The timeout (in seconds) for the data flow analysis during the check operation. Default is 0.
	 */
	private Integer dataFlowTimeout = 0;

	/**
	 * The list of programming language ecosystems to be considered during the check operation.
	 */
	private List<LanguageEcosystemEnum> checkLanguage = new ArrayList<>();

	/**
	 * The language to be used for generating the reports. Default is Chinese.
	 */
	private ReportLanguageEnum reportLanguageEnum = ReportLanguageEnum.CHINESE;

	/**
	 * Specifies whether to enable phantom type analysis. Default is false.
	 */
	private boolean phantom = false;

	/**
	 * Specifies whether to enable sparse analysis for improved performance. Default is false.
	 */
	private boolean sparseOn = false;

	private boolean unbalancedOn = false;

	/**
	 * A custom summary or message to describe the result of the check operation.
	 */
	private String customSummary;

	public Integer getPrecision() {
		return precision;
	}

	public void setPrecision(Integer precision) {
		this.precision = precision;
	}

	public Integer getDataFlowTimeout() {
		return dataFlowTimeout;
	}

	public void setDataFlowTimeout(Integer dataFlowTimeout) {
		this.dataFlowTimeout = dataFlowTimeout;
	}

	public List<LanguageEcosystemEnum> getCheckLanguage() {
		return checkLanguage;
	}

	public void setCheckLanguage(List<LanguageEcosystemEnum> checkLanguage) {
		this.checkLanguage = checkLanguage;
	}

	public ReportLanguageEnum getReportLanguageEnum() {
		return reportLanguageEnum;
	}

	public void setReportLanguageEnum(ReportLanguageEnum reportLanguageEnum) {
		this.reportLanguageEnum = reportLanguageEnum;
	}

	public boolean isPhantom() {
		return phantom;
	}

	public void setPhantom(boolean phantom) {
		this.phantom = phantom;
	}

	public boolean isSparseOn() {
		return sparseOn;
	}

	public void setSparseOn(boolean sparseOn) {
		this.sparseOn = sparseOn;
	}

	public String getCustomSummary() {
		return customSummary;
	}

	public void setCustomSummary(String customSummary) {
		this.customSummary = customSummary;
	}

	public boolean isUnbalancedOn() {
		return unbalancedOn;
	}

	public void setUnbalancedOn(boolean unbalancedOn) {
		this.unbalancedOn = unbalancedOn;
	}

	public static Builder builder() {
		return new Builder();
	}

	public static final class Builder {
		private Integer precision;
		private Integer dataFlowTimeout;
		private List<LanguageEcosystemEnum> checkLanguage;
		private ReportLanguageEnum reportLanguageEnum;
		private boolean phantom;
		private boolean unbalancedOn;
		private boolean sparseOn;
		private String customSummary;

		private Builder() {
		}

		public Builder withPrecision(Integer precision) {
			this.precision = precision;
			return this;
		}

		public Builder withDataFlowTimeout(Integer dataFlowTimeout) {
			this.dataFlowTimeout = dataFlowTimeout;
			return this;
		}

		public Builder withCheckLanguage(List<LanguageEcosystemEnum> checkLanguage) {
			this.checkLanguage = checkLanguage;
			return this;
		}

		public Builder withReportLanguageEnum(ReportLanguageEnum reportLanguageEnum) {
			this.reportLanguageEnum = reportLanguageEnum;
			return this;
		}

		public Builder withPhantom(boolean phantom) {
			this.phantom = phantom;
			return this;
		}

		public Builder withSparseOn(boolean sparseOn) {
			this.sparseOn = sparseOn;
			return this;
		}

		public Builder withCustomSummary(String customSummary) {
			this.customSummary = customSummary;
			return this;
		}

		public Builder withUnbalancedOn(boolean unbalancedOn) {
			this.unbalancedOn = unbalancedOn;
			return this;
		}

		public CheckConfig build() {
			CheckConfig checkConfig = new CheckConfig();
			checkConfig.setPrecision(precision);
			checkConfig.setDataFlowTimeout(dataFlowTimeout);
			checkConfig.setCheckLanguage(checkLanguage);
			checkConfig.setReportLanguageEnum(reportLanguageEnum);
			checkConfig.setPhantom(phantom);
			checkConfig.setSparseOn(sparseOn);
			checkConfig.setCustomSummary(customSummary);
			checkConfig.setUnbalancedOn(unbalancedOn);
			return checkConfig;
		}
	}

	@Override
	public String toString() {
		return new StringJoiner(", ", CheckConfig.class.getSimpleName() + "[", "]")
			.add("precision=" + precision)
			.add("dataFlowTimeout=" + dataFlowTimeout)
			.add("checkLanguage=" + checkLanguage)
			.add("reportLanguageEnum=" + reportLanguageEnum)
			.add("phantom=" + phantom)
			.add("sparseOn=" + sparseOn)
			.add("unbalancedOn=" + unbalancedOn)
			.add("customSummary='" + customSummary + "'")
			.toString();
	}
}
