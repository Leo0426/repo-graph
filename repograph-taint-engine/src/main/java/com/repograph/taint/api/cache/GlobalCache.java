/*
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
 */

package com.repograph.taint.api.cache;

import com.repograph.taint.api.IContext;

import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * global cache
 *
 * @author leolu
 * @since 2023/11/3
 */
public enum GlobalCache {

	INSTANCE;

	public static final String DEFAULT_KEY = "default";

	private final ConcurrentHashMap<String, IContext> cacheMap;

	GlobalCache() {
		cacheMap = new ConcurrentHashMap<>();
	}

	public IContext put(String key, IContext value) {
		Objects.requireNonNull(key, "cache key cannot be null");
		Objects.requireNonNull(value, "cache context cannot be null");
		return cacheMap.put(key, value);
	}

	public IContext get(String key) {
		return cacheMap.get(key);
	}

	public IContext getDefault() {
		return get(DEFAULT_KEY);
	}


	public Optional<IContext> getOptional(String key) {
		return Optional.ofNullable(get(key));
	}


}
