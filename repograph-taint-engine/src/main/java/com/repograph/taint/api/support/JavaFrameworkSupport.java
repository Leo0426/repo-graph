/*
 *
 * MIT License
 *
 * Copyright (c) 2023 Leo Lu.  All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 */

package com.repograph.taint.api.support;

/**
 * open java framework scan.
 *
 * @author leolu
 * @since 2024/6/11
 */
public class JavaFrameworkSupport {

	private boolean springOn;

	private boolean mybatisOn;

	private boolean hibernateOn;

	public boolean isSpringOn() {
		return springOn;
	}

	public void setSpringOn(boolean springOn) {
		this.springOn = springOn;
	}

	public boolean isMybatisOn() {
		return mybatisOn;
	}

	public void setMybatisOn(boolean mybatisOn) {
		this.mybatisOn = mybatisOn;
	}

	public boolean isHibernateOn() {
		return hibernateOn;
	}

	public void setHibernateOn(boolean hibernateOn) {
		this.hibernateOn = hibernateOn;
	}

	public static Builder builder() {
		return new Builder();
	}

	public static final class Builder {
		private boolean springOn;
		private boolean mybatisOn;
		private boolean hibernateOn;

		private Builder() {
		}

		public Builder withSpringOn(boolean springOn) {
			this.springOn = springOn;
			return this;
		}

		public Builder withMybatisOn(boolean mybatisOn) {
			this.mybatisOn = mybatisOn;
			return this;
		}

		public Builder withHibernateOn(boolean hibernateOn) {
			this.hibernateOn = hibernateOn;
			return this;
		}

		public JavaFrameworkSupport build() {
			JavaFrameworkSupport javaFrameworkSupport = new JavaFrameworkSupport();
			javaFrameworkSupport.setSpringOn(springOn);
			javaFrameworkSupport.setMybatisOn(mybatisOn);
			javaFrameworkSupport.setHibernateOn(hibernateOn);
			return javaFrameworkSupport;
		}
	}
}
